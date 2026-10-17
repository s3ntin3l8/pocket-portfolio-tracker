import { Decimal } from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  chainIndex,
  computeYearlyReturns,
  type IndexPoint,
  type YearlyPortfolioFlow,
} from "@portfolio/core";
import { portfolios } from "@portfolio/db";
import { getMarketData } from "../../../services/market-data.js";
import {
  benchmarkClosesInCurrency,
  computeBenchmarkIndex,
  ensureBenchmarkPrices,
  getBenchmarkPricesMulti,
  getUserBenchmarkSymbols,
} from "../../../services/benchmark.js";
import { getFxRatesForDates, type FxProvider } from "../../../services/fx.js";
import { boundaryFlows, excludeFxMissingInstruments } from "../shared/flows.js";
import { loadValuation } from "../shared/helpers.js";
import type { FastifyInstance } from "fastify";

export interface ComputeYearlyReturnsArgs {
  app: FastifyInstance;
  userId: string;
  /** The currency every series here is measured in; each benchmark is converted into it. */
  displayCurrency: string;
  /**
   * Per-date FX the caller already loaded into `displayCurrency` over the same date grid,
   * and the currencies it covers. Reused when it covers every selected benchmark's
   * currency; otherwise one load here covers them all.
   */
  fx?: { ratesByDate: Map<string, Record<string, string>>; currencies: string[] };
  /** Per-portfolio display-currency flows (marketValue + effectiveFlow) — already aggregated by the caller. */
  aggregatedFlows: { date: string; marketValue: string; effectiveFlow: string }[];
  /**
   * Per-portfolio display-currency NAV (net worth — already FX-converted and
   * cashCounted-aware by the caller), used to compute year-end/opening balances
   * for XIRR.
   */
  perPortfolio: { id: string; flows: { date: string; marketValue: string; currency: string }[] }[];
  /**
   * All boundary flows (in display currency) for this aggregate set, used to seed
   * per-year XIRR. The caller is responsible for computing each portfolio's flows
   * under its OWN boundary (cashCounted ? "inside" : "outside") before unioning —
   * this function treats the list as already boundary-correct.
   */
  boundaryFlows: { amount: string; date: Date }[];
  /**
   * A read-scoped PAT (audit A7): no benchmark price back-fill from the market-data
   * provider, and FX from cached rates only. The caller keeps such a result out of the
   * shared cache entry.
   */
  readOnly?: boolean;
}

/**
 * Compute per-year portfolio and benchmark returns for the Insights page.
 *
 * Side effects: may backfill missing benchmark price rows for any of the user's
 * selected symbols (never for `readOnly`). Errors during backfill are logged and treated
 * as missing data (the affected benchmark gets a null TWR for that year), not a hard fail.
 *
 * Returns a `YearlyReturnRow[]` ordered oldest → newest. The current calendar
 * year is the last row, flagged `isCurrentYear: true`.
 */
export async function computeInsightsYearlyReturns(args: ComputeYearlyReturnsArgs): Promise<
  {
    year: number;
    isCurrentYear: boolean;
    portfolioTwr: string | null;
    portfolioXirr: string | null;
    benchmarks: {
      symbol: string;
      displayName: string;
      nativeCurrency: string;
      twr: string | null;
      activeReturn: string | null;
    }[];
  }[]
> {
  const {
    app,
    userId,
    displayCurrency,
    fx,
    aggregatedFlows,
    perPortfolio,
    boundaryFlows: bflows,
    readOnly = false,
  } = args;
  const db = app.db;

  // Portfolio index = same chainIndex the rest of /insights uses.
  const pfIndex: IndexPoint[] = chainIndex(aggregatedFlows);

  if (pfIndex.length === 0) return [];

  // Group boundary flows by calendar year. amount is a string (Decimal), as the
  // core helper expects.
  const flowsByYear = new Map<number, YearlyPortfolioFlow[]>();
  for (const f of bflows) {
    const year = f.date.getUTCFullYear();
    const arr = flowsByYear.get(year) ?? [];
    arr.push({ amount: f.amount, date: f.date });
    flowsByYear.set(year, arr);
  }

  const endNavByYear = yearEndNavs(
    perPortfolio,
    new Set(pfIndex.map((p) => Number(p.date.slice(0, 4)))),
  );

  // Benchmarks: read user's selected symbols, backfill missing dates, compute
  // the per-symbol chained index.
  const benchmarkSymbols = await getUserBenchmarkSymbols(db, userId);
  if (benchmarkSymbols.length === 0) {
    return computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: flowsByYear,
      pfEndNavByYear: endNavByYear,
      benchmarks: [],
      asOf: new Date(),
    });
  }

  const allDates = pfIndex.map((p) => p.date);
  const symbolNames = benchmarkSymbols.map((b) => b.symbol);

  if (!readOnly) {
    for (const sym of symbolNames) {
      await ensureBenchmarkPrices(db, getMarketData, userId, sym, allDates);
    }
  }

  const priceMap = await getBenchmarkPricesMulti(db, userId, symbolNames, allDates);
  // One per-date FX map for every selected benchmark's currency, shared by all symbols:
  // the caller's when it covers them (the usual single-benchmark case), else one load.
  const bmCurrencies = [...new Set(benchmarkSymbols.map((b) => b.currency ?? "USD"))];
  const ratesByDate =
    fx && bmCurrencies.every((c) => c === displayCurrency || fx.currencies.includes(c))
      ? fx.ratesByDate
      : await getFxRatesForDates(
          db,
          bmCurrencies,
          displayCurrency,
          allDates,
          readOnly ? null : undefined,
        );

  const benchmarkInputs: {
    symbol: string;
    displayName: string;
    nativeCurrency: string;
    index: IndexPoint[];
  }[] = [];
  for (const b of benchmarkSymbols) {
    const inner = priceMap.get(b.symbol);
    if (!inner) continue;
    // Closes converted to the display currency at each date's own FX rate, like the
    // portfolio index this is compared against (#1020). A per-year ratio of native
    // closes is NOT currency-invariant: it ignores the year's FX move, which the
    // display-currency portfolio return includes.
    const nativeCurrency = b.currency ?? "USD";
    const { closes } = await benchmarkClosesInCurrency(
      db,
      inner,
      allDates,
      nativeCurrency,
      displayCurrency,
      { ratesByDate },
    );
    const idx = computeBenchmarkIndex(closes);
    if (idx.length === 0) continue;
    benchmarkInputs.push({
      symbol: b.symbol,
      displayName: b.displayName,
      nativeCurrency,
      index: idx,
    });
  }

  return computeYearlyReturns({
    pfIndex,
    pfFlowsByYear: flowsByYear,
    pfEndNavByYear: endNavByYear,
    benchmarks: benchmarkInputs,
    asOf: new Date(),
  });
}

/**
 * Load the boundary flows for a set of portfolios in a target display currency,
 * under a single `boundary` mode. Wraps the shared `boundaryFlows` helper (which
 * already handles the kind-aware "inside" vs. "outside" semantics defined in
 * CONTRIBUTING.md) so the per-year XIRR is computed against the same cash-flow
 * source as `/contributions` and the rest of the insights cards.
 *
 * Paired with the year-end net worths, so both sides must describe the same thing (#1020):
 * - Each flow converts at its OWN date's FX rate, like each year-end NAV converts at its
 *   snapshot date's rate. `/networth`'s all-time XIRR keeps today's rate, because its
 *   terminal value is today's net worth at today's rate.
 * - The instruments the valuation can't value for lack of an FX rate are dropped
 *   (`excludeFxMissingInstruments`), exactly as `/networth` does; otherwise their buys
 *   would stay in the flows with no value against them.
 *
 * Transactions come from the same `loadValuation` the hero XIRR uses (full rows through
 * `toCoreTxns`, so `status` and `tax` are present — issue #736, audit B13), with each
 * portfolio's own corporate actions (audit B9).
 *
 * A caller whose portfolios don't all share one boundary (i.e. a mix of
 * `cashCounted` true/false) must call this once per boundary group and union the
 * results — see `registerInsightsRoutes`'s `insidePfIds`/`outsidePfIds` split,
 * which mirrors how `/networth`'s hero XIRR computes each portfolio's flows
 * under its own boundary before concatenating them.
 */
export async function loadBoundaryFlowsForUser(
  app: FastifyInstance,
  userId: string,
  portfolioIds: string[],
  displayCurrency: string,
  boundary: "inside" | "outside",
  /** `null` = cached FX rates only (read-scoped PAT, audit A7) for both the valuation and
   *  the per-date flow conversion; default the provider. */
  fxProvider?: FxProvider | null,
): Promise<{ amount: string; date: Date }[]> {
  if (portfolioIds.length === 0) return [];
  const owned = await app.db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(inArray(portfolios.id, portfolioIds), eq(portfolios.userId, userId)));
  const perPortfolio = await Promise.all(
    owned.map(async ({ id }) => {
      const { coreTxns, summary, corporateActions } = await loadValuation(
        app,
        id,
        displayCurrency,
        undefined,
        boundary === "inside",
        undefined,
        fxProvider,
      );
      return boundaryFlows(
        app,
        excludeFxMissingInstruments(coreTxns, summary),
        boundary,
        displayCurrency,
        corporateActions,
        "flowDate",
        fxProvider,
      );
    }),
  );
  return perPortfolio
    .flat()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((p) => ({ amount: String(p.amount), date: p.date }));
}

/**
 * Per-year end NAV (in display currency): the sum, across portfolios, of each
 * portfolio's last snapshot in that year. `pf.flows[].marketValue` actually carries each
 * portfolio's NAV (net worth — see ComputeYearlyReturnsArgs.perPortfolio); the field
 * name is inherited from the shared per-portfolio flow shape. `computeYearlyReturns`
 * also reads this same map at `year - 1` as each year's OPENING NAV. Summed with
 * Decimal (audit B12) — the old string→Number→string round trip drifted.
 */
export function yearEndNavs(
  perPortfolio: ComputeYearlyReturnsArgs["perPortfolio"],
  years: Iterable<number>,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const year of years) {
    let total = new Decimal(0);
    for (const pf of perPortfolio) {
      let last: { date: string; marketValue: string } | null = null;
      for (const f of pf.flows) {
        if (Number(f.date.slice(0, 4)) !== year) continue;
        if (!last || f.date > last.date) last = f;
      }
      if (last) total = total.add(last.marketValue);
    }
    out.set(year, total.toFixed());
  }
  return out;
}
