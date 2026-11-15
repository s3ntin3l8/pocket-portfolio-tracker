import { and, eq, isNotNull, lt } from "drizzle-orm";
import { ibkrConnections, trConnections } from "@portfolio/db";
import type { DB } from "../../db/client.js";

/**
 * Clear any `syncing=true` flag left behind by a worker that never got to run its
 * terminal update — most commonly a process restart/crash mid-sync. Safe to call from
 * a fresh process: a brand-new process can't have an in-flight worker of its own, so
 * anything still marked `syncing` at boot is necessarily stale. A genuinely still-queued
 * pg-boss job (rare — the process only just started) re-runs and re-clears `syncing`
 * normally when it completes. Exported (and split out of `startScheduler`) so it's
 * unit-testable against PGlite without needing real Postgres/pg-boss.
 */
export async function resetStaleSyncFlags(
  db: DB,
): Promise<{ trConnections: number; ibkrConnections: number }> {
  const staleReset = { syncing: false, updatedAt: new Date() };
  const [staleTr, staleIbkr] = await Promise.all([
    db
      .update(trConnections)
      .set(staleReset)
      .where(eq(trConnections.syncing, true))
      .returning({ id: trConnections.id }),
    db
      .update(ibkrConnections)
      .set(staleReset)
      .where(eq(ibkrConnections.syncing, true))
      .returning({ id: ibkrConnections.id }),
  ]);
  return { trConnections: staleTr.length, ibkrConnections: staleIbkr.length };
}

/** A pairing waits at most ~210 s (`pairingTimeoutMs`); anything older is abandoned. */
export const ABANDONED_PAIRING_MS = 10 * 60 * 1000;

/**
 * A renew the user walked away from (dialog dismissed, tab closed, process restarted) leaves the
 * row in `awaiting_2fa` with no pairing behind it, and the hourly sweep only syncs `connected`
 * rows — so sync would stop silently. A connection that had a working session before goes back
 * to `expired`, which is what raises the Renew prompt. A never-connected row (no session) is
 * left alone: it is a first setup, not something to nag about.
 */
export async function reapAbandonedPairings(
  db: DB,
  now: Date = new Date(),
): Promise<{ trConnections: number }> {
  const reaped = await db
    .update(trConnections)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(trConnections.status, "awaiting_2fa"),
        isNotNull(trConnections.sessionEnc),
        lt(trConnections.updatedAt, new Date(now.getTime() - ABANDONED_PAIRING_MS)),
      ),
    )
    .returning({ id: trConnections.id });
  return { trConnections: reaped.length };
}
