/**
 * pg-boss's own pg pool. `max` stays capped (see client.ts for the shared connection
 * budget). Keepalive + `query_timeout` exist because a silently dropped socket (network
 * prefix change, server-side drop without RST) otherwise stays checked out forever: every
 * queue then fails with "timeout exceeded when trying to connect" and no background job
 * (TR/IBKR sync, snapshots, price refresh) runs until the process restarts.
 */
export const PG_BOSS_POOL_OPTIONS = {
  max: 5,
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
  query_timeout: 120_000,
} as const;

/** How long an unbroken streak of connection errors may last before the process exits. */
export const POOL_FAILURE_EXIT_AFTER_MS = 15 * 60_000;
/** A gap between connection errors longer than this ends the streak (errors recur every ~10 s). */
const STREAK_GAP_MS = 2 * 60_000;

const CONNECTION_ERROR =
  /timeout exceeded when trying to connect|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|Connection terminated|Client has encountered a connection error/i;

export function isPoolConnectionError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && CONNECTION_ERROR.test(message);
}

/**
 * Self-heal backstop: if pg-boss keeps reporting connection errors for
 * {@link POOL_FAILURE_EXIT_AFTER_MS} without a quiet gap, call `exit` so the container
 * restart policy brings up a fresh pool. Healthy operation emits no errors, so no
 * success signal is needed — a gap ends the streak.
 */
export function createPoolWatchdog(opts: {
  exit: () => void;
  now?: () => number;
  exitAfterMs?: number;
}) {
  const now = opts.now ?? Date.now;
  const exitAfterMs = opts.exitAfterMs ?? POOL_FAILURE_EXIT_AFTER_MS;
  let streakStart: number | null = null;
  let lastError = 0;
  return {
    onError(err: unknown): void {
      if (!isPoolConnectionError(err)) return;
      const t = now();
      if (streakStart === null || t - lastError > STREAK_GAP_MS) streakStart = t;
      lastError = t;
      if (t - streakStart >= exitAfterMs) opts.exit();
    },
  };
}
