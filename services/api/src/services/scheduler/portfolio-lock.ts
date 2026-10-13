/**
 * Per-portfolio mutual exclusion shared by the recompute and backfill-portfolio workers
 * (audit D8). The two queues write the same `portfolio_snapshots` / `prices` rows, so
 * running them concurrently for one portfolio is "last writer wins". pg-boss singleton
 * keys are scoped per queue (uniqueness is `(name, singleton_on, singleton_key)`), so no
 * key choice can serialize across queues — the exclusion has to live in the handlers.
 * In-process, which matches the deployment topology (one API/worker process); a second
 * process would need a DB-level lock instead.
 */
const tails = new Map<string, Promise<unknown>>();

export async function withPortfolioLock<T>(portfolioId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(portfolioId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(portfolioId, tail);
  try {
    return await run;
  } finally {
    // Only clear the entry if no newer caller has queued behind us (it would have
    // replaced `tails[portfolioId]`); deleting unconditionally would drop their wait.
    if (tails.get(portfolioId) === tail) tails.delete(portfolioId);
  }
}
