import type { HistoryPoint } from "@portfolio/api-client";
import {
  getServerApi,
  normalizeCostBasis,
  listPortfoliosCached,
  getSelectedPortfolioId,
  getSummaryCached,
  getPerformanceCached,
  getNetWorthCached,
  resolveHolderScope,
  type NetWorthResult,
} from "./_shared";
import { classifyFailure } from "@/lib/data-status";

export async function loadNetWorth(
  costBasis?: "purchase_price" | "total_paid",
  period = "max",
): Promise<NetWorthResult> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized" };
  const resolvedCostBasis = normalizeCostBasis(costBasis);
  try {
    const portfolios = await listPortfoliosCached();
    if (portfolios.length === 0) return { status: "empty" };
    const wanted = await getSelectedPortfolioId();
    const selected = portfolios.find((p) => p.id === wanted);
    if (selected) {
      const [summary, perf] = await Promise.all([
        getSummaryCached(selected.id, resolvedCostBasis),
        getPerformanceCached(selected.id),
      ]);
      return {
        status: "ok",
        data: { ...summary, xirr: perf.xirr, portfolioCount: 1, asOf: perf.asOf, period: "max" },
      };
    }
    const holderId = await resolveHolderScope(portfolios);
    const data = await getNetWorthCached(resolvedCostBasis, holderId, period);
    if (data.portfolioCount === 0) return { status: "empty" };
    return { status: "ok", data };
  } catch (err) {
    return classifyFailure(err);
  }
}

/** The holder scope the aggregate net-worth views are currently filtered to (undefined when a
 *  single portfolio is selected or no multi-portfolio holder scope is active) — threaded to
 *  client components that refetch `/networth/history` themselves (the range picker), so the
 *  refetch keeps the same scope as the server-rendered `initial` series. */
export async function loadNetWorthHolderScope(): Promise<string | undefined> {
  try {
    const portfolios = await listPortfoliosCached();
    return (await currentHolderScope(portfolios)).holderId;
  } catch {
    return undefined;
  }
}

/** Selected portfolio (if any) and, when none is selected, the active holder scope. */
async function currentHolderScope(portfolios: Awaited<ReturnType<typeof listPortfoliosCached>>) {
  const wanted = await getSelectedPortfolioId();
  const selected = portfolios.find((p) => p.id === wanted);
  const holderId = selected ? undefined : await resolveHolderScope(portfolios);
  return { selected, holderId };
}

/** Whether intraday (1D/7D) history exists yet; `false` on any failure (hides the chips). */
export async function loadHasIntraday(): Promise<boolean> {
  const api = await getServerApi();
  if (!api) return false;
  try {
    return (await api.getIntradayStatus()).hasIntraday;
  } catch {
    return false;
  }
}

export async function loadNetWorthHistory(range = "1y"): Promise<HistoryPoint[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    const portfolios = await listPortfoliosCached();
    const { selected, holderId } = await currentHolderScope(portfolios);
    if (selected) return await api.getPortfolioHistory(selected.id, range);
    return await api.getNetWorthHistory(range, holderId ? { holderId } : undefined);
  } catch {
    return [];
  }
}
