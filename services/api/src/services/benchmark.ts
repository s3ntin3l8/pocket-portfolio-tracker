import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { benchmarkPrices, userBenchmarkSymbols } from "@portfolio/db";
import { chainIndex, type DailyValueFlow } from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import type { DB } from "../db/client.js";

export interface BenchmarkIndexPoint {
  date: string;
  index: string;
  pct: string;
}

export interface BenchmarkConfig {
  symbol: string;
  currency: string;
}

/** A user-selected reference index, as read from the `user_benchmark_symbols` table. */
export interface UserBenchmarkSymbol {
  symbol: string;
  displayName: string;
  displayOrder: number;
  /** Inferred from the most recent `benchmark_prices` row, or unset if no data yet. */
  currency: string | null;
}

const DEFAULT_BENCHMARK_SYMBOL = "^GSPC";
const DEFAULT_BENCHMARK_CURRENCY = "USD";

/**
 * Reads the user's selected reference indices in `displayOrder`. If the user
 * has none (shouldn't happen post-migration, but defensive), returns the S&P
 * 500 default so downstream code can always assume at least one symbol.
 */
export async function getUserBenchmarkSymbols(
  db: DB,
  userId: string,
): Promise<UserBenchmarkSymbol[]> {
  const rows = await db
    .select({
      symbol: userBenchmarkSymbols.symbol,
      displayName: userBenchmarkSymbols.displayName,
      displayOrder: userBenchmarkSymbols.displayOrder,
    })
    .from(userBenchmarkSymbols)
    .where(eq(userBenchmarkSymbols.userId, userId))
    .orderBy(asc(userBenchmarkSymbols.displayOrder));

  if (rows.length === 0) {
    return [
      {
        symbol: DEFAULT_BENCHMARK_SYMBOL,
        displayName: "S&P 500",
        displayOrder: 0,
        currency: DEFAULT_BENCHMARK_CURRENCY,
      },
    ];
  }

  // One round-trip to fetch the currency for each unique symbol.
  const symbols = rows.map((r) => r.symbol);
  const latestRows = await db
    .selectDistinctOn([benchmarkPrices.symbol], {
      symbol: benchmarkPrices.symbol,
      currency: benchmarkPrices.currency,
    })
    .from(benchmarkPrices)
    .where(and(eq(benchmarkPrices.userId, userId), inArray(benchmarkPrices.symbol, symbols)))
    .orderBy(asc(benchmarkPrices.symbol), desc(benchmarkPrices.date));

  const currencyBySymbol = new Map(latestRows.map((r) => [r.symbol, r.currency]));
  return rows.map((r) => ({
    ...r,
    currency: currencyBySymbol.get(r.symbol) ?? null,
  }));
}

/**
 * Convenience: the primary (displayOrder=0) benchmark, used by the existing
 * BenchmarkCard (active return / tracking error / correlation). Returns the
 * symbol + its inferred currency. The legacy `userPreferences.benchmarkSymbol`
 * column is gone; this function now reads from the new table.
 */
export async function getUserBenchmarkConfig(
  db: DB,
  userId: string,
  _displayCurrency: string,
): Promise<{ symbol: string; currency: string }> {
  const [primary] = await db
    .select({ symbol: userBenchmarkSymbols.symbol, currency: benchmarkPrices.currency })
    .from(userBenchmarkSymbols)
    .leftJoin(
      benchmarkPrices,
      and(
        eq(benchmarkPrices.userId, userBenchmarkSymbols.userId),
        eq(benchmarkPrices.symbol, userBenchmarkSymbols.symbol),
      ),
    )
    .where(and(eq(userBenchmarkSymbols.userId, userId), eq(userBenchmarkSymbols.displayOrder, 0)))
    .orderBy(desc(benchmarkPrices.date))
    .limit(1);

  return {
    symbol: primary?.symbol ?? DEFAULT_BENCHMARK_SYMBOL,
    currency: primary?.currency ?? DEFAULT_BENCHMARK_CURRENCY,
  };
}

export async function fetchBenchmarkPrices(
  db: DB,
  marketData: MarketDataService,
  userId: string,
  symbol: string,
  fromDate: string,
): Promise<void> {
  const ref = {
    symbol,
    market: "US",
    assetClass: "equity" as const,
    currency: DEFAULT_BENCHMARK_CURRENCY,
  };
  const candles = await marketData.getHistoryFrom(ref, fromDate);
  if (!candles || candles.length === 0) return;

  const existing = new Map<string, boolean>();
  const rows = await db
    .select({ date: benchmarkPrices.date })
    .from(benchmarkPrices)
    .where(and(eq(benchmarkPrices.userId, userId), eq(benchmarkPrices.symbol, symbol)));
  for (const r of rows) {
    existing.set(r.date, true);
  }

  for (const c of candles) {
    if (existing.has(c.date)) continue;
    await db
      .insert(benchmarkPrices)
      .values({
        userId,
        symbol,
        date: c.date,
        close: c.close,
        currency: c.currency ?? DEFAULT_BENCHMARK_CURRENCY,
        source: "yahoo",
      })
      .onConflictDoNothing({
        target: [benchmarkPrices.userId, benchmarkPrices.symbol, benchmarkPrices.date],
      });
  }
}

export async function getBenchmarkPrices(
  db: DB,
  userId: string,
  symbol: string,
  dates: string[],
): Promise<Map<string, string>> {
  if (dates.length === 0) return new Map();
  const rows = await db
    .select({ date: benchmarkPrices.date, close: benchmarkPrices.close })
    .from(benchmarkPrices)
    .where(
      and(
        eq(benchmarkPrices.userId, userId),
        eq(benchmarkPrices.symbol, symbol),
        inArray(benchmarkPrices.date, dates),
      ),
    )
    .orderBy(benchmarkPrices.date);
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.date, r.close);
  }
  return map;
}

/**
 * Multi-symbol variant: returns one Map<date, close> per symbol. Single
 * round-trip; empty symbols are skipped (not represented in the result).
 */
export async function getBenchmarkPricesMulti(
  db: DB,
  userId: string,
  symbols: string[],
  dates: string[],
): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  if (symbols.length === 0 || dates.length === 0) return out;
  const rows = await db
    .select({
      symbol: benchmarkPrices.symbol,
      date: benchmarkPrices.date,
      close: benchmarkPrices.close,
    })
    .from(benchmarkPrices)
    .where(
      and(
        eq(benchmarkPrices.userId, userId),
        inArray(benchmarkPrices.symbol, symbols),
        inArray(benchmarkPrices.date, dates),
      ),
    )
    .orderBy(benchmarkPrices.date);
  for (const r of rows) {
    let inner = out.get(r.symbol);
    if (!inner) {
      inner = new Map();
      out.set(r.symbol, inner);
    }
    inner.set(r.date, r.close);
  }
  return out;
}

export function computeBenchmarkIndex(
  prices: { date: string; close: string }[],
): BenchmarkIndexPoint[] {
  if (prices.length === 0) return [];

  const dailyFlows: DailyValueFlow[] = prices.map((p) => ({
    date: p.date,
    marketValue: p.close,
    effectiveFlow: "0",
  }));

  const indexed = chainIndex(dailyFlows);
  return indexed.map((p) => ({ date: p.date, index: p.index, pct: p.pct }));
}

export function computeActiveReturn(
  portfolioIndex: { date: string; pct: string }[],
  benchmarkIndex: { date: string; pct: string }[],
): { activeReturn: string; trackingError: string; correlation: string } | null {
  if (portfolioIndex.length === 0 || benchmarkIndex.length === 0) return null;

  const bmByDate = new Map(benchmarkIndex.map((p) => [p.date, Number(p.pct)]));
  const raw: { pf: number; bm: number }[] = [];
  for (const p of portfolioIndex) {
    const bmPct = bmByDate.get(p.date);
    if (bmPct !== undefined) {
      raw.push({ pf: Number(p.pct), bm: bmPct });
    }
  }
  if (raw.length < 2) return null;

  // `portfolioIndex`/`benchmarkIndex` are each chained from their OWN first element
  // (chainIndex's base), which don't necessarily coincide with the first date they
  // both actually have data for — e.g. the portfolio's earliest snapshot falling on a
  // weekend/holiday the benchmark market was closed, or benchmark history not yet
  // backfilled all the way to the portfolio's start. Left uncorrected, "pfFinal -
  // bmFinal" would compare the portfolio's return since ITS base against the
  // benchmark's return since a DIFFERENT (later) base — an apples-to-oranges number
  // that can be wildly wrong. Rebase both series to their first common date so every
  // downstream figure (active return, tracking error, correlation) measures the same
  // window for both.
  const pfBase = raw[0].pf;
  const bmBase = raw[0].bm;
  const rebase = (pct: number, base: number) => ((1 + pct / 100) / (1 + base / 100) - 1) * 100;
  const common = raw.map(({ pf, bm }) => ({ pf: rebase(pf, pfBase), bm: rebase(bm, bmBase) }));

  // Active return = portfolio total return - benchmark total return (at end of series)
  const pfFinal = common[common.length - 1].pf;
  const bmFinal = common[common.length - 1].bm;
  const activeReturn = pfFinal - bmFinal;

  // `common[i].pf`/`.bm` are CUMULATIVE returns (in percentage points) since the common
  // base date — not daily returns. The true daily return between two index levels is
  // (1+cum_i/100)/(1+cum_{i-1}/100) - 1, NOT the difference of the cumulative pcts: that
  // difference scales with how large the cumulative return has already grown, so late in
  // a long series the same day-to-day move produces an ever-larger "diff", inflating the
  // annualized tracking error (and distorting correlation).
  const dailyReturn = (curr: number, prev: number) => (1 + curr / 100) / (1 + prev / 100) - 1;

  // Tracking error = stddev of daily return differences
  const diffs: number[] = [];
  for (let i = 1; i < common.length; i++) {
    const pfDailyRet = dailyReturn(common[i].pf, common[i - 1].pf);
    const bmDailyRet = dailyReturn(common[i].bm, common[i - 1].bm);
    diffs.push((pfDailyRet - bmDailyRet) * 100);
  }

  if (diffs.length < 2) return null;

  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((acc, d) => acc + (d - meanDiff) ** 2, 0) / (diffs.length - 1);
  const trackingError = Math.sqrt(variance) * Math.sqrt(252);

  // Correlation = Pearson's r between portfolio and benchmark daily returns
  const pfRets: number[] = [];
  const bmRets: number[] = [];
  for (let i = 1; i < common.length; i++) {
    pfRets.push(dailyReturn(common[i].pf, common[i - 1].pf));
    bmRets.push(dailyReturn(common[i].bm, common[i - 1].bm));
  }

  const meanPf = pfRets.reduce((a, b) => a + b, 0) / pfRets.length;
  const meanBm = bmRets.reduce((a, b) => a + b, 0) / bmRets.length;
  let cov = 0;
  let varPf = 0;
  let varBm = 0;
  for (let i = 0; i < pfRets.length; i++) {
    const dPf = pfRets[i] - meanPf;
    const dBm = bmRets[i] - meanBm;
    cov += dPf * dBm;
    varPf += dPf ** 2;
    varBm += dBm ** 2;
  }
  const correlation = varPf > 0 && varBm > 0 ? cov / Math.sqrt(varPf * varBm) : 0;

  // `pf`/`bm` (and thus activeReturn/trackingError above) are in percentage-POINT
  // units, because chainIndex's `pct` is already ×100 (e.g. 12.5 meaning +12.5%).
  // Divide by 100 here so both come out as fractions, matching every other rate the
  // API returns (and what the web card's formatPercent — an Intl percent formatter
  // that itself multiplies by 100 — expects). Correlation is a dimensionless Pearson
  // r and is scale-invariant, so it's returned as-is.
  return {
    activeReturn: String(activeReturn / 100),
    trackingError: String(trackingError / 100),
    correlation: String(correlation),
  };
}
