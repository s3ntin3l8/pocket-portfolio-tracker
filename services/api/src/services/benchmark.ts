import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { benchmarkPrices, userBenchmarkSymbols } from "@portfolio/db";
import { chainIndex, convert, fxAvailable, type DailyValueFlow } from "@portfolio/core";
import { MarketDataError, type MarketDataService } from "@portfolio/market-data";
import type { DB } from "../db/client.js";
import { chunk } from "../lib/chunk.js";
import { defaultFxProvider, getFxRatesForDates, makeFxRateFn, type FxProvider } from "./fx.js";

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
  let candles: Awaited<ReturnType<typeof marketData.getHistoryFrom>>;
  try {
    candles = await marketData.getHistoryFrom(ref, fromDate);
  } catch (err) {
    // Pre-#749 this was unreachable (providers returned `null` on non-OK HTTP, the
    // service treated that as `[]`). Post-#749 providers throw MarketDataError on
    // non-OK, and this function is called from three route handlers
    // (transactions/history.ts:109, insights.ts:213, yearly-returns.ts:124) — a 500
    // here would 500 whole page requests on a benchmark refresh error. Match the
    // pre-#749 behaviour: silently skip on provider error so the page renders
    // without the benchmark series rather than failing outright.
    if (err instanceof MarketDataError) return;
    throw err;
  }
  if (!candles || candles.length === 0) return;

  const existing = new Map<string, boolean>();
  const rows = await db
    .select({ date: benchmarkPrices.date })
    .from(benchmarkPrices)
    .where(and(eq(benchmarkPrices.userId, userId), eq(benchmarkPrices.symbol, symbol)));
  for (const r of rows) {
    existing.set(r.date, true);
  }

  // Chunked multi-row insert (audit D3): one statement per ~500 rows instead of one
  // round-trip per candle.
  const fresh = candles
    .filter((c) => !existing.has(c.date))
    .map((c) => ({
      userId,
      symbol,
      date: c.date,
      close: c.close,
      currency: c.currency ?? DEFAULT_BENCHMARK_CURRENCY,
      source: "yahoo",
    }));
  for (const part of chunk(fresh)) {
    await db
      .insert(benchmarkPrices)
      .values(part)
      .onConflictDoNothing({
        target: [benchmarkPrices.userId, benchmarkPrices.symbol, benchmarkPrices.date],
      });
  }
}

/**
 * How far back a cached benchmark close satisfies a wanted date (audit D3): weekends and
 * market holidays have no row, so "no row for this exact calendar date" is not "missing".
 */
export const BENCHMARK_CARRY_FORWARD_DAYS = 5;

/** (user|symbol|earliestWanted) lookups already attempted on a given UTC day. */
const attemptedToday = new Map<string, string>();

/** Test hook: forget remembered fetch attempts. */
export function clearBenchmarkFetchCache(): void {
  attemptedToday.clear();
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Earliest wanted date that cached rows cannot satisfy, or null. A date is satisfied by a
 * cached row on it or within {@link BENCHMARK_CARRY_FORWARD_DAYS} before it — except the
 * most recent two days, which need an exact row so the series' last point is not frozen
 * for up to five days (that one is bounded by the once-per-day attempt cache instead).
 */
export async function earliestUnsatisfiedBenchmarkDate(
  db: DB,
  userId: string,
  symbol: string,
  dates: string[],
  now: Date = new Date(),
): Promise<string | null> {
  if (dates.length === 0) return null;
  const sorted = [...new Set(dates)].sort();
  const rows = await db
    .select({ date: benchmarkPrices.date })
    .from(benchmarkPrices)
    .where(
      and(
        eq(benchmarkPrices.userId, userId),
        eq(benchmarkPrices.symbol, symbol),
        gte(benchmarkPrices.date, shiftDays(sorted[0]!, -BENCHMARK_CARRY_FORWARD_DAYS)),
        lte(benchmarkPrices.date, sorted[sorted.length - 1]!),
      ),
    )
    .orderBy(asc(benchmarkPrices.date));
  const known = rows.map((r) => r.date);
  const recentFrom = shiftDays(now.toISOString().slice(0, 10), -1);
  let i = 0;
  let last: string | undefined;
  for (const d of sorted) {
    while (i < known.length && known[i]! <= d) last = known[i++];
    const exact = last === d;
    const carried = last !== undefined && last >= shiftDays(d, -BENCHMARK_CARRY_FORWARD_DAYS);
    if (d >= recentFrom ? !exact : !carried) return d;
  }
  return null;
}

/**
 * Backfill benchmark closes for `dates` only when cached rows leave a gap that
 * carry-forward cannot cover, and at most once per (user, symbol, earliest-gap) per UTC
 * day — a provider that cannot fill the gap is not hammered on every request (audit D3).
 * Best-effort: never throws.
 */
export async function ensureBenchmarkPrices(
  db: DB,
  getMarketData: () => Promise<MarketDataService>,
  userId: string,
  symbol: string,
  dates: string[],
  now: Date = new Date(),
): Promise<void> {
  try {
    const earliest = await earliestUnsatisfiedBenchmarkDate(db, userId, symbol, dates, now);
    if (earliest === null) return;
    const key = `${userId}|${symbol}|${earliest}`;
    const day = now.toISOString().slice(0, 10);
    if (attemptedToday.get(key) === day) return;
    attemptedToday.set(key, day);
    await fetchBenchmarkPrices(db, await getMarketData(), userId, symbol, earliest);
  } catch {
    // non-fatal — the benchmark series is best-effort
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

/**
 * A benchmark's closes on `dates`, date-sorted and converted from the index's quote
 * currency into `targetCurrency` at each date's OWN FX rate (#1020). This is the one
 * place a benchmark series gets its currency: the Insights card, the per-year table and
 * the history charts all compare it against a portfolio index measured in that target
 * currency, and a ratio of native closes is not currency-invariant once FX moves.
 *
 * `closes` is the already-loaded `date → close` map (single- or multi-symbol loaders);
 * dates without a close are skipped. Pass `ratesByDate` when the caller already loaded
 * `getFxRatesForDates` with the benchmark's currency among its currencies; otherwise
 * it is loaded here. `cachedFxOnly` restricts that load to cached `fx_rates` rows (no
 * provider fetch or persist — for read-scoped PATs); `fxProvider` overrides the
 * configured provider otherwise (tests). A day with no rate is dropped (never 1:1,
 * audit B2) — `makeFxRateFn` records the currency for `fxMissingCurrencies` — and
 * counted in `fxMissingDates`.
 */
export async function benchmarkClosesInCurrency(
  db: DB,
  closes: Map<string, string>,
  dates: string[],
  quoteCurrency: string,
  targetCurrency: string,
  opts: {
    ratesByDate?: Map<string, Record<string, string>>;
    cachedFxOnly?: boolean;
    fxProvider?: FxProvider;
  } = {},
): Promise<{ closes: { date: string; close: string }[]; fxMissingDates: number }> {
  const wanted = [...new Set(dates)].filter((d) => closes.has(d)).sort();
  if (quoteCurrency === targetCurrency) {
    return { closes: wanted.map((d) => ({ date: d, close: closes.get(d)! })), fxMissingDates: 0 };
  }
  const provider = opts.cachedFxOnly ? null : (opts.fxProvider ?? defaultFxProvider());
  const rates =
    opts.ratesByDate ??
    (await getFxRatesForDates(db, [quoteCurrency], targetCurrency, wanted, provider));
  let fxMissingDates = 0;
  const out: { date: string; close: string }[] = [];
  for (const d of wanted) {
    const fx = makeFxRateFn(rates.get(d) ?? {}, targetCurrency);
    if (!fxAvailable(quoteCurrency, targetCurrency, fx)) {
      fxMissingDates++;
      continue;
    }
    out.push({ date: d, close: convert(closes.get(d)!, quoteCurrency, targetCurrency, fx) });
  }
  return { closes: out, fxMissingDates };
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

/**
 * Carry-forward benchmark values to portfolio dates that lack a direct match.
 * Walks `result` in ascending date order, assigning the last known benchmark
 * index/pct to each point until a new match is found. Dates before the first
 * benchmark price are left untouched (no fields set).
 */
export function carryForwardBenchmark(
  result: { date: string; benchmarkIndex?: string; benchmarkPct?: string }[],
  bmById: Map<string, BenchmarkIndexPoint>,
): void {
  let lastBp: BenchmarkIndexPoint | undefined;
  for (const p of result) {
    const bp = bmById.get(p.date);
    if (bp) {
      lastBp = bp;
    }
    if (lastBp) {
      p.benchmarkIndex = lastBp.index;
      p.benchmarkPct = lastBp.pct;
    }
  }
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
