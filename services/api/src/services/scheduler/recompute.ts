import { withPortfolioLock } from "./portfolio-lock.js";

export interface RecomputeJob {
  data: unknown;
}

/**
 * Body of the recompute-history worker. Every job in the batch is attempted, but a
 * failure is rethrown afterwards so pg-boss records it and retries (audit D8) — the old
 * handler logged and swallowed, so a transient provider/DB error silently lost the
 * recompute (a later import would have to re-trigger it).
 */
export async function runRecomputeJobs(
  jobs: RecomputeJob[],
  deps: {
    recompute: (portfolioId: string, fromDate: string) => Promise<unknown>;
    onDone?: (portfolioId: string, fromDate: string, result: unknown) => void;
    onError?: (err: unknown, portfolioId: string, fromDate: string) => void;
  },
): Promise<void> {
  let firstError: unknown;
  for (const job of jobs) {
    const { portfolioId, fromDate } = job.data as { portfolioId: string; fromDate: string };
    try {
      const result = await withPortfolioLock(portfolioId, () =>
        deps.recompute(portfolioId, fromDate),
      );
      deps.onDone?.(portfolioId, fromDate, result);
    } catch (err) {
      deps.onError?.(err, portfolioId, fromDate);
      firstError ??= err;
    }
  }
  if (firstError !== undefined) throw firstError;
}
