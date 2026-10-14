/**
 * A small in-memory sliding-window limiter keyed by an arbitrary string (here: the user id).
 * Process-local — with several API replicas each enforces its own window, which is fine for a
 * cost cap. `now` is injectable for tests.
 */
export function createWindowLimiter(opts: { max: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;

  return {
    /** Records a hit and returns `{ ok: true }`, or `{ ok: false, retryAfterSec }` when over. */
    hit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
      const t = now();
      const cutoff = t - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((ts) => ts > cutoff);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((recent[0]! + opts.windowMs - t) / 1000)),
        };
      }
      recent.push(t);
      hits.set(key, recent);
      // Keep the map from growing without bound: drop keys whose hits have all expired.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.every((ts) => ts <= cutoff)) hits.delete(k);
      }
      return { ok: true };
    },
  };
}
