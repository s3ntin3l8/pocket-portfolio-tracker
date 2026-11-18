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
  /timeout exceeded when trying to connect|Query read timeout|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|Connection terminated|Client has encountered a connection error/i;
const CONNECTION_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "57P01",
  "08006",
]);

export function isPoolConnectionError(err: unknown): boolean {
  // pg-boss re-emits some errors as plain objects (`{...error, message, stack}`), so read
  // `message`/`code` off anything rather than requiring an Error instance.
  const e = err as { message?: unknown; code?: unknown } | null;
  if (typeof e?.code === "string" && CONNECTION_CODES.has(e.code)) return true;
  return typeof e?.message === "string" && CONNECTION_ERROR.test(e.message);
}

/**
 * Self-heal backstop: if pg-boss keeps reporting connection errors for
 * {@link POOL_FAILURE_EXIT_AFTER_MS} without a quiet gap, run `probe`. The same errors
 * also appear on a saturated-but-working pool, which a restart cannot fix, so `probe`
 * (a trivial query through the pool itself) decides: it resolves `true` when the pool
 * answers (streak reset, no exit) and `false`/rejects when it does not (`exit` fires, once).
 * Healthy operation emits no errors, so no success signal is needed — a gap ends the streak.
 */
export function createPoolWatchdog(opts: {
  exit: () => void | Promise<void>;
  probe?: () => Promise<boolean>;
  now?: () => number;
  exitAfterMs?: number;
}) {
  const now = opts.now ?? Date.now;
  const exitAfterMs = opts.exitAfterMs ?? POOL_FAILURE_EXIT_AFTER_MS;
  let streakStart: number | null = null;
  let lastError = 0;
  let busy = false;
  let fired = false;
  return {
    async onError(err: unknown): Promise<void> {
      if (fired || !isPoolConnectionError(err)) return;
      const t = now();
      if (streakStart === null || t - lastError > STREAK_GAP_MS) streakStart = t;
      lastError = t;
      if (t - streakStart < exitAfterMs || busy) return;
      busy = true;
      try {
        const alive = opts.probe ? await opts.probe().catch(() => false) : false;
        if (alive) {
          streakStart = null; // pool answers: slow/saturated, not wedged
          return;
        }
        fired = true;
        await opts.exit();
      } finally {
        busy = false;
      }
    },
  };
}
