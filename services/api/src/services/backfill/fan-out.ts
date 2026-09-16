import { eq, and, inArray, notInArray, lt } from "drizzle-orm";
import { backfillJobs } from "@portfolio/db";
import type { DB } from "../../db/client.js";
import { loadBackfillContext, firstHeldDateFrom, laterDateKey } from "./shared.js";

/** Fallback poll cadence for a direct caller (test, dev script) that doesn't supply one.
 *  The scheduler always passes an explicit value derived from queue config — see
 *  BACKFILL_FAN_OUT_POLL_INTERVAL_MS in scheduler/config.ts. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Fallback poll deadline for a direct caller that doesn't supply one. The scheduler
 *  always passes an explicit value derived from BACKFILL_PORTFOLIO_QUEUE_OPTIONS'
 *  expireInSeconds — see BACKFILL_FAN_OUT_MAX_WAIT_MS in scheduler/config.ts. */
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000;

/** Coordination rows older than this, not claimed by the current run, are reaped as
 *  orphans — leftovers whose `chunk_start` changed between runs, which the planner's
 *  upsert can never reach on its own (a changed chunk_start is a different conflict
 *  key). Comfortably exceeds a portfolio job's worst-case lifetime with retries
 *  (expireInSeconds 2400s × up to 3 attempts ≈ 2h). */
const FAN_OUT_ORPHAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface FanOutSubJob {
  backfillJobId: string;
  instrumentId: string;
  chunkStart: string;
  chunkEnd: string;
  /** See BackfillOptions.tailOnly (core.ts) / InstrumentChunkData.tailOnly
   *  (instrument.ts) — always set here, never left `undefined`, so a forgetful caller
   *  can't accidentally drop it the way the pre-#773 planner did. */
  tailOnly: boolean;
}

export interface FanOutPlan {
  portfolioId: string;
  instruments: number;
  pending: number;
  /** Uniform stamp written to every row claimed by this run (`backfill_jobs.created_at`).
   *  Every later read/delete is scoped to it, so a racing replan can't clobber — or be
   *  clobbered by — this run's rows. */
  claimedAt: Date;
  subJobIds: string[];
  subJobs: FanOutSubJob[];
}

export class FanOutEnqueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FanOutEnqueueError";
  }
}

export class FanOutSubJobFailedError extends Error {
  readonly failedIds: string[];
  constructor(message: string, failedIds: string[]) {
    super(message);
    this.name = "FanOutSubJobFailedError";
    this.failedIds = failedIds;
  }
}

export class FanOutTimeoutError extends Error {
  readonly waitedMs: number;
  constructor(message: string, waitedMs: number) {
    super(message);
    this.name = "FanOutTimeoutError";
    this.waitedMs = waitedMs;
  }
}

export class FanOutAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FanOutAbortedError";
  }
}

export class FanOutOwnershipLostError extends Error {
  readonly lostIds: string[];
  constructor(message: string, lostIds: string[]) {
    super(message);
    this.name = "FanOutOwnershipLostError";
    this.lostIds = lostIds;
  }
}

/**
 * Plan a portfolio's per-instrument fan-out: compute each held instrument's own chunk
 * boundary and upsert a `backfill_jobs` coordination row for it. Does NOT enqueue
 * anything — see `runFanOut`/`pollFanOutCompletion` for that. Idempotent: safe to call
 * again for the same portfolio (a crashed prior run, a pg-boss retry) without a
 * duplicate-key error, because the coordination row is upserted rather than inserted —
 * see the `onConflictDoUpdate` comment below for why `DO UPDATE` and not `DO NOTHING`.
 */
export async function planFanOut(
  db: DB,
  portfolioId: string,
  opts: { fromDate?: string; tailOnly?: boolean } = {},
): Promise<FanOutPlan> {
  const claimedAt = new Date();
  const ctx = await loadBackfillContext(db, portfolioId, opts);
  if (!ctx) {
    return { portfolioId, instruments: 0, pending: 0, claimedAt, subJobIds: [], subJobs: [] };
  }
  const { txRows, startDate, today, instrRows } = ctx;

  const subJobs: FanOutSubJob[] = [];
  const claimedIds: string[] = [];

  for (const instr of instrRows) {
    const firstHeldDate = firstHeldDateFrom(txRows, instr.id) ?? startDate;
    const chunkStart = laterDateKey(firstHeldDate, startDate);

    const [row] = await db
      .insert(backfillJobs)
      .values({
        portfolioId,
        instrumentId: instr.id,
        chunkStart,
        chunkEnd: today,
        status: "pending",
        createdAt: claimedAt,
      })
      .onConflictDoUpdate({
        // A prior run's coordination row for this exact (portfolio, instrument,
        // chunkStart) may still exist — orphaned by a crash between insert and
        // cleanup, or genuinely still in progress if this is a pg-boss retry of the
        // same planner job. `DO UPDATE`, not `DO NOTHING`: Postgres's `DO NOTHING`
        // returns no row on conflict, so `.returning()` would silently drop this
        // instrument from the plan (the `if (row)` guard below would swallow it); and
        // a leftover `"done"`/`"failed"` row must be reset to `"pending"` with today's
        // chunkEnd, not reused as-is — reusing it would make the poller declare this
        // instrument complete for a window it never actually re-ran.
        target: [backfillJobs.portfolioId, backfillJobs.instrumentId, backfillJobs.chunkStart],
        set: { chunkEnd: today, status: "pending", createdAt: claimedAt },
      })
      .returning({ id: backfillJobs.id });

    if (row) {
      claimedIds.push(row.id);
      subJobs.push({
        backfillJobId: row.id,
        instrumentId: instr.id,
        chunkStart,
        chunkEnd: today,
        tailOnly: opts.tailOnly ?? false,
      });
    }
  }

  // Orphan GC: a row for this portfolio that wasn't claimed by this run (its
  // chunkStart no longer matches any currently-held instrument's computed boundary —
  // the upsert above can't reach it, since a different chunkStart is a different
  // conflict key) and is old enough that it can't belong to a still-in-flight
  // concurrent run.
  const orphanCutoff = new Date(claimedAt.getTime() - FAN_OUT_ORPHAN_MAX_AGE_MS);
  await db
    .delete(backfillJobs)
    .where(
      and(
        eq(backfillJobs.portfolioId, portfolioId),
        claimedIds.length > 0 ? notInArray(backfillJobs.id, claimedIds) : undefined,
        lt(backfillJobs.createdAt, orphanCutoff),
      ),
    );

  return {
    portfolioId,
    instruments: instrRows.length,
    pending: subJobs.length,
    claimedAt,
    subJobIds: subJobs.map((j) => j.backfillJobId),
    subJobs,
  };
}

/** Races a sleep against `signal`'s abort event so an already-elapsed poll interval
 *  doesn't delay noticing an abort by up to a full interval. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FanOutAbortedError("fan-out aborted before sleep"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FanOutAbortedError("fan-out aborted during sleep"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Best-effort delete of this run's coordination rows, scoped to `claimedAt` so a
 * mistaken or duplicate call matches zero rows once a different run has re-claimed
 * them. Never throws.
 */
export async function cleanupFanOutRows(
  db: DB,
  subJobIds: string[],
  claimedAt: Date,
): Promise<number> {
  if (subJobIds.length === 0) return 0;
  try {
    const deleted = await db
      .delete(backfillJobs)
      .where(and(inArray(backfillJobs.id, subJobIds), eq(backfillJobs.createdAt, claimedAt)))
      .returning({ id: backfillJobs.id });
    return deleted.length;
  } catch {
    return 0;
  }
}

/**
 * Poll `backfill_jobs` until every row in `plan.subJobIds` is `"done"`, one is
 * `"failed"`, the deadline is exceeded, or `signal` aborts. Owns cleanup: deletes this
 * run's rows only on a DEFINITE VERDICT about them — success, or a genuine sub-job
 * failure. On abort/timeout/ownership-lost, the rows are left alone: at that point we no
 * longer know whether they're safely ours to delete or whether sub-jobs are still in
 * flight, and leaving them is safe precisely because `planFanOut` is idempotent over
 * them (a later replan reclaims and resets them rather than colliding).
 */
export async function pollFanOutCompletion(
  db: DB,
  plan: Pick<FanOutPlan, "subJobIds" | "claimedAt">,
  opts: { pollIntervalMs?: number; maxWaitMs?: number; signal?: AbortSignal } = {},
): Promise<{ done: number; waitedMs: number; cleaned: boolean }> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const { subJobIds, claimedAt } = plan;
  const startedAt = Date.now();

  if (subJobIds.length === 0) return { done: 0, waitedMs: 0, cleaned: false };

  if (opts.signal?.aborted) {
    throw new FanOutAbortedError("fan-out aborted before polling began");
  }

  let verdict: "success" | "failed" | null = null;
  try {
    for (;;) {
      await abortableSleep(pollIntervalMs, opts.signal);

      const waitedMs = Date.now() - startedAt;
      if (waitedMs > maxWaitMs) {
        throw new FanOutTimeoutError(
          `fan-out poll exceeded maxWaitMs (${maxWaitMs}ms) for ${subJobIds.length} sub-jobs`,
          waitedMs,
        );
      }

      const statusRows = await db
        .select({
          id: backfillJobs.id,
          status: backfillJobs.status,
          createdAt: backfillJobs.createdAt,
        })
        .from(backfillJobs)
        .where(inArray(backfillJobs.id, subJobIds));

      const byId = new Map(statusRows.map((r) => [r.id, r]));
      const lostIds = subJobIds.filter((id) => {
        const row = byId.get(id);
        return !row || row.createdAt.getTime() !== claimedAt.getTime();
      });
      if (lostIds.length > 0) {
        throw new FanOutOwnershipLostError(
          `${lostIds.length}/${subJobIds.length} fan-out coordination rows were re-claimed or deleted by a concurrent run`,
          lostIds,
        );
      }

      const failedIds = statusRows.filter((r) => r.status === "failed").map((r) => r.id);
      if (failedIds.length > 0) {
        verdict = "failed";
        throw new FanOutSubJobFailedError(
          `${failedIds.length}/${subJobIds.length} instrument sub-jobs failed`,
          failedIds,
        );
      }

      const doneCount = statusRows.filter((r) => r.status === "done").length;
      if (doneCount === subJobIds.length) {
        verdict = "success";
        return { done: doneCount, waitedMs: Date.now() - startedAt, cleaned: true };
      }
    }
  } finally {
    if (verdict === "success" || verdict === "failed") {
      await cleanupFanOutRows(db, subJobIds, claimedAt);
    }
  }
}

/**
 * Enqueue every sub-job in `plan` (via the injected `enqueue`, mirroring
 * `backfillStalePortfolios`'s `{ enqueue }` pattern in `sweep.ts` — no pg-boss
 * dependency here), then poll for completion. The first `enqueue` failure throws
 * immediately rather than polling out a full deadline for jobs that were never sent,
 * and — since that's also a definite verdict — cleans up before throwing.
 */
export async function runFanOut(
  db: DB,
  plan: FanOutPlan,
  opts: {
    enqueue: (sub: FanOutSubJob) => Promise<boolean>;
    pollIntervalMs?: number;
    maxWaitMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ enqueued: number; done: number; waitedMs: number; cleaned: boolean }> {
  if (plan.subJobs.length === 0) {
    return { enqueued: 0, done: 0, waitedMs: 0, cleaned: false };
  }

  let enqueued = 0;
  for (const sub of plan.subJobs) {
    const ok = await opts.enqueue(sub);
    if (!ok) {
      await cleanupFanOutRows(db, plan.subJobIds, plan.claimedAt);
      throw new FanOutEnqueueError(
        `failed to enqueue sub-job for instrument ${sub.instrumentId} (backfillJobId ${sub.backfillJobId})`,
      );
    }
    enqueued++;
  }

  const { done, waitedMs, cleaned } = await pollFanOutCompletion(db, plan, {
    pollIntervalMs: opts.pollIntervalMs,
    maxWaitMs: opts.maxWaitMs,
    signal: opts.signal,
  });

  return { enqueued, done, waitedMs, cleaned };
}
