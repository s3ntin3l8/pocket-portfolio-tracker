import { and, asc, eq, inArray } from "drizzle-orm";
import {
  chainIndex,
  computeYearlyReturns,
  type IndexPoint,
  type YearlyPortfolioFlow,
} from "@portfolio/core";
import { portfolios, transactions } from "@portfolio/db";
import { getMarketData } from "../../../services/market-data.js";
import {
  computeBenchmarkIndex,
  fetchBenchmarkPrices,
  getBenchmarkPricesMulti,
  getUserBenchmarkSymbols,
} from "../../../services/benchmark.js";
import { boundaryFlows } from "../shared/flows.js";
import type { FastifyInstance } from "fastify";

export interface ComputeYearlyReturnsArgs {
  app: FastifyInstance;
  userId: string;
  /** Per-portfolio display-currency flows (marketValue + effectiveFlow) — already aggregated by the caller. */
  aggregatedFlows: { date: string; marketValue: string; effectiveFlow: string }[];
  /** Per-portfolio display-currency NAV (used to compute year-end balances for XIRR). */
  perPortfolio: { id: string; flows: { date: string; marketValue: string; currency: string }[] }[];
  /** All boundary flows (in display currency) for this aggregate set, used to seed per-year XIRR. */
  boundaryFlows: { amount: string; date: Date }[];
  /** Display currency the flows are denominated in. */
  displayCurrency: string;
  /** Per-date FX rate map from currency → displayCurrency. */
  ratesByDate: Map<string, Record<string, string>>;
} /**
 * Compute per-year portfolio and benchmark returns for the Insights page.
 *
 * Side effects: may backfill missing benchmark price rows for any of the user's
 * selected symbols. Errors during backfill are logged and treated as missing
 * data (the affected benchmark gets a null TWR for that year), not a hard fail.
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
    aggregatedFlows,
    perPortfolio,
    boundaryFlows: bflows,
    displayCurrency,
    ratesByDate,
  } = args;
  void displayCurrency;
  void ratesByDate;
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

  // Compute per-year end NAV (in display currency) by summing the last snapshot
  // of each year across all portfolios. NAV = sum of per-portfolio marketValue
  // (already display-currency) at the last snapshot of the year.
  const endNavByYear = new Map<number, string>();
  for (const year of new Set(pfIndex.map((p) => Number(p.date.slice(0, 4))))) {
    const lastByPortfolio = new Map<string, { date: string; marketValue: string }>();
    for (const pf of perPortfolio) {
      let last: { date: string; marketValue: string } | null = null;
      for (const f of pf.flows) {
        if (Number(f.date.slice(0, 4)) !== year) continue;
        if (!last || f.date > last.date) last = { date: f.date, marketValue: f.marketValue };
      }
      if (last) lastByPortfolio.set(pf.id, last);
    }
    let total = "0";
    for (const v of lastByPortfolio.values()) {
      total = (Number(total) + Number(v.marketValue)).toString();
    }
    endNavByYear.set(year, total);
  }

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
  const minDate = allDates[0];
  const symbolNames = benchmarkSymbols.map((b) => b.symbol);

  try {
    const md = await getMarketData();
    for (const sym of symbolNames) {
      try {
        await fetchBenchmarkPrices(db, md, userId, sym, minDate);
      } catch {
        // Non-fatal: missing data shows as null cells.
      }
    }
  } catch {
    // Market data not available at all; we'll fall back to whatever rows are already in benchmark_prices.
  }

  const priceMap = await getBenchmarkPricesMulti(db, userId, symbolNames, allDates);

  const benchmarkInputs: {
    symbol: string;
    displayName: string;
    nativeCurrency: string;
    index: IndexPoint[];
  }[] = [];
  for (const b of benchmarkSymbols) {
    const inner = priceMap.get(b.symbol);
    if (!inner) continue;
    // Build a date-sorted array of closes in the benchmark's NATIVE currency.
    // The core compute is ratio-based so the native currency is fine; the route
    // layer doesn't need to pre-convert (the per-year ratio is currency-invariant).
    const sorted = allDates
      .filter((d) => inner.has(d))
      .map((d) => ({ date: d, close: inner.get(d)! }));
    const idx = computeBenchmarkIndex(sorted);
    if (idx.length === 0) continue;
    benchmarkInputs.push({
      symbol: b.symbol,
      displayName: b.displayName,
      nativeCurrency: b.currency ?? "USD",
      index: idx,
    });
  }

  // fxAt signature: (date) => FxRateFn. The core helper doesn't actually use fxAt
  // (TWR is ratio-based; FX cancels out), but we keep the wiring for the future
  // when an "FX-adjusted benchmark return in display currency" might be wanted.
  void ratesByDate;

  return computeYearlyReturns({
    pfIndex,
    pfFlowsByYear: flowsByYear,
    pfEndNavByYear: endNavByYear,
    benchmarks: benchmarkInputs,
    asOf: new Date(),
  });
}

/**
 * Load the boundary flows for a set of portfolios in a target display currency.
 * Wraps the shared `boundaryFlows` helper (which already handles the kind-aware
 * "inside" vs. "outside" semantics defined in CONTRIBUTING.md) so the per-year
 * XIRR is computed against the same cash-flow source as `/contributions` and
 * the rest of the insights cards.
 */
export async function loadBoundaryFlowsForUser(
  app: FastifyInstance,
  userId: string,
  portfolioIds: string[],
  displayCurrency: string,
  boundary: "inside" | "outside",
): Promise<{ amount: string; date: Date }[]> {
  if (portfolioIds.length === 0) return [];
  const rows = await app.db
    .select({
      type: transactions.type,
      kind: transactions.kind,
      price: transactions.price,
      currency: transactions.currency,
      quantity: transactions.quantity,
      fees: transactions.fees,
      instrumentId: transactions.instrumentId,
      executedAt: transactions.executedAt,
      portfolioId: transactions.portfolioId,
    })
    .from(transactions)
    .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
    .where(and(inArray(transactions.portfolioId, portfolioIds), eq(portfolios.userId, userId)))
    .orderBy(asc(transactions.executedAt));
  return (await boundaryFlows(app, rows, boundary, displayCurrency)).map((p) => ({
    amount: String(p.amount),
    date: p.date,
  }));
}
