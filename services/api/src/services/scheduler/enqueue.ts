import type { PgBoss } from "pg-boss";
import type { FanOutSubJob } from "../backfill/fan-out.js";
import {
  BACKFILL_INSTRUMENT_QUEUE,
  BACKFILL_PORTFOLIO_QUEUE,
  BACKFILL_PORTFOLIO_SINGLETON_SECONDS,
  IBKR_SYNC_QUEUE,
  INSTRUMENT_META_QUEUE,
  INSTRUMENT_META_SINGLETON_SECONDS,
  RECOMPUTE_QUEUE,
  RECOMPUTE_SINGLETON_SECONDS,
  TR_SYNC_QUEUE,
} from "./config.js";

/** How long a trigger-job dedup key stands: long enough to absorb a double-click or an
 * admin trigger landing on top of the same job's own cron firing, short enough that a
 * genuinely repeated manual trigger a minute later isn't silently swallowed. */
const TRIGGER_SINGLETON_SECONDS = 30;

let activeBoss: PgBoss | null = null;

export function setActiveBoss(boss: PgBoss | null): void {
  activeBoss = boss;
}

export { activeBoss };

/** Return the active pg-boss instance, or null when the scheduler is not running. */
export function getActiveBoss(): PgBoss | null {
  return activeBoss;
}

function usesPglite(url: string): boolean {
  return !url || url.startsWith("pglite://");
}

export { usesPglite };

/**
 * Enqueue a manual run of a named job queue.
 * Returns `{ queued: true }` on success, `{ queued: false }` when pg-boss is unavailable
 * OR when this exact trigger already has one in flight (`alreadyInFlight: true` — see
 * below). An optional `payload` object is forwarded as the job data (e.g. `{ force: true }`).
 */
export async function triggerJob(
  name: string,
  payload: Record<string, unknown> = {},
): Promise<{ queued: boolean; alreadyInFlight?: boolean }> {
  if (!activeBoss) return { queued: false };
  const jobId = await activeBoss.send(name, payload, {
    // The dedup key includes the payload, not just `name` — a "force" trigger must not
    // silently collide with (and no-op behind) a plain trigger of the same job fired
    // moments earlier, or vice versa. Only a genuinely identical repeat within the
    // window collapses.
    singletonKey: `${name}:${JSON.stringify(payload)}`,
    singletonSeconds: TRIGGER_SINGLETON_SECONDS,
  });
  // pg-boss's send() returns null on a singleton-key collision — no job was actually
  // created. Reporting `queued: true` here would let the caller write a misleading
  // "triggered" audit log entry for a request that silently did nothing.
  if (jobId === null) return { queued: false, alreadyInFlight: true };
  return { queued: true };
}

/**
 * Enqueue a per-connection IBKR sync, deduplicated. Falls back to inline when pg-boss is
 * unavailable (PGlite / tests).
 */
export async function enqueueIbkrSync(connectionId: string): Promise<{ queued: boolean }> {
  if (!activeBoss) return { queued: false };
  await activeBoss.send(
    IBKR_SYNC_QUEUE,
    { connectionId },
    { singletonKey: `ibkr-sync:${connectionId}`, singletonSeconds: 30 },
  );
  return { queued: true };
}

/**
 * Enqueue a per-connection TR sync, deduplicated so double-clicking doesn't queue two
 * concurrent syncs for the same connection. Returns `{ queued: true }` when the job was
 * enqueued, `{ queued: false }` when pg-boss is unavailable (caller falls back to inline).
 */
export async function enqueueTrSync(connectionId: string): Promise<{ queued: boolean }> {
  if (!activeBoss) return { queued: false };
  await activeBoss.send(
    TR_SYNC_QUEUE,
    { connectionId },
    { singletonKey: `tr-sync:${connectionId}`, singletonSeconds: 30 },
  );
  return { queued: true };
}

/**
 * Enqueue a history recompute for a portfolio, collapsed (debounced) via singletonKey so
 * rapid bulk-edits (multi-file import, TR sync) collapse to one job. fromDate bounds the
 * recompute to transactions on or after that date (pass min(changed executedAt)).
 * No-op when pg-boss is unavailable (PGlite / tests).
 */
export async function enqueueRecompute(portfolioId: string, fromDate: string): Promise<void> {
  if (!activeBoss) return;
  try {
    await activeBoss.send(
      RECOMPUTE_QUEUE,
      { portfolioId, fromDate },
      { singletonKey: portfolioId, singletonSeconds: RECOMPUTE_SINGLETON_SECONDS },
    );
  } catch {
    // non-fatal
  }
}

/**
 * Enqueue a per-portfolio backfill onto BACKFILL_PORTFOLIO_QUEUE, deduplicated per
 * portfolio so a force sweep landing on top of an already-queued/running heal for the
 * same portfolio collapses instead of duplicating. `fromDate`/`tailOnly` mirror
 * `BackfillOptions` (undefined `fromDate` means "from inception"; `tailOnly` suppresses
 * the max-range provider fallback for a heal that's only chasing the trailing edge).
 *
 * Returns whether the send actually succeeded. Unlike `enqueueRecompute`/
 * `enqueueInstrumentMetadata` (a debounce over an otherwise-idempotent nightly job, where
 * swallowing a send failure is harmless), this is the SOLE delivery mechanism for the
 * whole backfill fan-out — the caller (`backfillStalePortfolios`) counts this return value
 * into `SweepResult.queued`/`enqueueFailed` so a DB hiccup mid-loop shows up as a real
 * count instead of a "queued: N" log that overclaims how many portfolios were actually
 * enqueued.
 */
export async function enqueueBackfillPortfolio(
  portfolioId: string,
  fromDate?: string,
  tailOnly?: boolean,
): Promise<boolean> {
  if (!activeBoss) return false;
  try {
    await activeBoss.send(
      BACKFILL_PORTFOLIO_QUEUE,
      { portfolioId, fromDate, tailOnly },
      { singletonKey: portfolioId, singletonSeconds: BACKFILL_PORTFOLIO_SINGLETON_SECONDS },
    );
    return true;
  } catch (err) {
    // The count alone (SweepResult.enqueueFailed) doesn't say WHY a send failed — no
    // fastify logger is threaded through this module, so this is the only place the
    // actual error is ever seen. console.error, not console.warn: a real backfill
    // silently never got enqueued for this portfolio.
    console.error(`[backfill] enqueue failed for portfolio ${portfolioId}:`, err);
    return false;
  }
}

/**
 * Enqueue one per-instrument fan-out sub-job onto BACKFILL_INSTRUMENT_QUEUE (#761/#773).
 * `singletonKey` is the coordination row's own id — not a throttle key, since
 * `planFanOut`'s idempotent upsert (see fan-out.ts) can legitimately REUSE the same
 * `backfillJobId` across a pg-boss retry of the portfolio job. Deliberately no
 * `singletonSeconds`: under pg-boss's default `standard` queue policy `singletonKey`
 * alone doesn't dedup (that needs a `short`/`singleton`/`stately`/`exclusive` policy) —
 * `singletonSeconds` is a time *throttle*, and pairing it with a reused key would make a
 * legitimate retry's re-send return `null` (job id) and silently never enqueue, turning
 * a recoverable retry into a guaranteed poll timeout. The key is still passed so
 * `pgboss.job` rows stay greppable by coordination row during an incident.
 *
 * Returns whether the send succeeded, mirroring `enqueueBackfillPortfolio` — this is
 * the sole delivery mechanism for the sub-job, so `runFanOut` (fan-out.ts) treats a
 * `false` as fatal rather than silently losing the sub-job.
 */
export async function enqueueBackfillInstrument(
  sub: FanOutSubJob & { portfolioId: string },
): Promise<boolean> {
  if (!activeBoss) return false;
  try {
    const jobId = await activeBoss.send(
      BACKFILL_INSTRUMENT_QUEUE,
      {
        backfillJobId: sub.backfillJobId,
        portfolioId: sub.portfolioId,
        instrumentId: sub.instrumentId,
        chunkStart: sub.chunkStart,
        chunkEnd: sub.chunkEnd,
        tailOnly: sub.tailOnly,
      },
      { singletonKey: sub.backfillJobId },
    );
    // pg-boss's send() returns null on a singleton-key collision — see the doc comment
    // above for why that shouldn't happen here under the standard policy, but treat it
    // as a failure rather than silently reporting success for a sub-job that was never
    // actually (re-)enqueued.
    return jobId !== null;
  } catch (err) {
    console.error(
      `[backfill] enqueue failed for instrument sub-job ${sub.backfillJobId} (instrument ${sub.instrumentId}):`,
      err,
    );
    return false;
  }
}

/**
 * Enqueue a sector-enrichment sweep, debounced so repeated dashboard requests
 * within a 6-hour window collapse to a single job execution. Fire-and-forget —
 * call with `void enqueueInstrumentMetadata()`.
 *
 * No-op when pg-boss is unavailable (PGlite / tests).
 */
export async function enqueueInstrumentMetadata(): Promise<void> {
  if (!activeBoss) return;
  try {
    await activeBoss.send(
      INSTRUMENT_META_QUEUE,
      {},
      { singletonKey: "sector-self-heal", singletonSeconds: INSTRUMENT_META_SINGLETON_SECONDS },
    );
  } catch {
    // non-fatal
  }
}
