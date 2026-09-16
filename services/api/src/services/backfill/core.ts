import { eq, inArray, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  backfillJobs,
  corporateActions,
  dividendEvents,
  instruments,
  portfolios,
  portfolioSnapshots,
  prices,
  scrapedQuotes,
  transactions,
} from "@portfolio/db";
import {
  buildDailyValueFlows,
  cashBalances,
  computeHoldings,
  netWorth,
  splitAdjustmentFactor,
  toDateKey,
  MAX_PRICE_CARRY_FORWARD_DAYS,
  type PriceSeriesKind,
} from "@portfolio/core";
import type { Candle, InstrumentRef, MarketDataService } from "@portfolio/market-data";
import type { DB } from "../../db/client.js";
import { toCoreTxns } from "../tx-core.js";
import { getFxRatesForDates, makeFxRateFn } from "../fx.js";

export interface BackfillOptions {
  /** Only recompute snapshots on or after this date (ISO YYYY-MM-DD). */
  fromDate?: string;
  /**
   * This is a trailing-edge-only heal (history back to inception is already intact;
   * only the gap since `fromDate` is missing). An empty `getHistoryFrom` result means
   * "no new candles since then", not "fetch the whole history again" — skip the
   * max-range provider fallback so a permanently dead feed doesn't trigger a full
   * re-fetch on every sweep run. See issue #737.
   */
  tailOnly?: boolean;
  /**
   * When true, don't fetch prices or compute snapshots. Instead, create coordination
   * records in `backfill_jobs` and return sub-job metadata so the caller can fan out
   * per-instrument work via BACKFILL_INSTRUMENT_QUEUE. The caller is responsible for
   * calling `computeBackfillSnapshots` once all sub-jobs complete. See #761.
   */
  planner?: boolean;
}

export interface BackfillResult {
  instruments: number;
  days: number;
  /** Instruments whose earliest available candle is later than their first-held date. */
  truncated: string[];
  /** Instruments for which no price candle could be found at all this run. */
  unpriced: string[];
}

/**
 * Extended result when `planner: true`. The planner didn't do any work itself —
 * it only enqueued per-instrument sub-jobs. `pending` tells the scheduler how
 * many sub-jobs are still running so it can poll for completion; `subJobs` is the
 * full list of coordination-row IDs for progress tracking.
 */
export interface BackfillPlannerResult extends BackfillResult {
  pending: number;
  subJobIds: string[];
  subJobs: Array<{
    backfillJobId: string;
    instrumentId: string;
    chunkStart: string;
    chunkEnd: string;
  }>;
}

export async function backfillPortfolioHistory(
  db: DB,
  marketData: MarketDataService,
  _ttlMs: number,
  portfolioId: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult | BackfillPlannerResult> {
  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolioId));

  if (txRows.length === 0) return { instruments: 0, days: 0, truncated: [], unpriced: [] };

  const [pf] = await db
    .select({ cashCounted: portfolios.cashCounted })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1);
  const cashCounted = pf?.cashCounted ?? true;

  const inceptionMs = Math.min(...txRows.map((r) => r.executedAt.getTime()));
  const inceptionDate = toDateKey(new Date(inceptionMs));
  const startDate = opts.fromDate && opts.fromDate > inceptionDate ? opts.fromDate : inceptionDate;
  const today = toDateKey(new Date());

  if (startDate > today) return { instruments: 0, days: 0, truncated: [], unpriced: [] };

  const instrIds = [
    ...new Set(txRows.map((r) => r.instrumentId).filter((x): x is string => x !== null)),
  ];
  const instrRows = instrIds.length
    ? await db.select().from(instruments).where(inArray(instruments.id, instrIds))
    : [];
  const instrById = new Map(instrRows.map((i) => [i.id, i]));

  // --- Planner path (#761): create coordination records and return early ---
  if (opts.planner) {
    const subJobs: BackfillPlannerResult["subJobs"] = [];

    // Determine per-instrument chunk boundaries
    for (const instr of instrRows) {
      const firstHeld = txRows
        .filter((r) => r.instrumentId === instr.id)
        .reduce((min, r) => (r.executedAt < min ? r.executedAt : min), txRows[0]!.executedAt);
      const firstHeldDate = toDateKey(firstHeld);
      const fetchFrom = firstHeldDate < startDate ? startDate : firstHeldDate;

      const [row] = await db
        .insert(backfillJobs)
        .values({
          portfolioId,
          instrumentId: instr.id,
          chunkStart: fetchFrom,
          chunkEnd: today,
          status: "pending",
        })
        .returning({ id: backfillJobs.id });

      if (row) {
        subJobs.push({
          backfillJobId: row.id,
          instrumentId: instr.id,
          chunkStart: fetchFrom,
          chunkEnd: today,
        });
      }
    }

    return {
      instruments: instrRows.length,
      days: 0,
      truncated: [],
      unpriced: [],
      pending: subJobs.length,
      subJobIds: subJobs.map((j) => j.backfillJobId),
      subJobs,
    };
  }

  const caRows = instrIds.length
    ? await db
        .select()
        .from(corporateActions)
        .where(inArray(corporateActions.instrumentId, instrIds))
    : [];
  const coreCas = caRows.map((r) => ({
    instrumentId: r.instrumentId,
    type: r.type as "split" | "bonus" | "rights",
    ratio: r.ratio,
    exDate: new Date(r.exDate),
  }));

  const truncated: string[] = [];
  const unpriced: string[] = [];
  const rawPrices = new Map<string, Map<string, { close: string; currency: string }>>();

  const goldBuybackByMarket = new Map<string, string>();
  const buybackRows = await db
    .select()
    .from(scrapedQuotes)
    .where(inArray(scrapedQuotes.key, ["gold:antam-buyback", "gold:galeri24-buyback"]));
  for (const r of buybackRows) {
    const market = r.key.replace("gold:", "").replace("-buyback", "").toUpperCase();
    goldBuybackByMarket.set(market, r.value);
  }

  let xauSpotHistory: Map<string, string> | null = null;

  const goldBuybackInstrs = instrRows.filter(
    (i) => i.assetClass === "gold" && (i.market === "ANTAM" || i.market === "GALERI24"),
  );

  if (goldBuybackInstrs.length > 0) {
    const goldCurrency = goldBuybackInstrs[0]!.currency;
    const xauRef: InstrumentRef = {
      symbol: `XAU${goldCurrency}`,
      market: "XAU",
      assetClass: "gold",
      currency: goldCurrency,
    };
    // Distinct catch here (not `.catch(() => [])`) — a provider throw on the XAU spot
    // fetch is an error, not a "no data" result, and silently conflating them with the
    // empty-array path is exactly how #749 distinguished errors from misses for the
    // per-instrument fetch below.
    let xauCandles: Candle[];
    try {
      xauCandles = await marketData.getHistoryFrom(xauRef, startDate);
    } catch (err) {
      console.warn(
        `[backfill] provider error fetching XAU spot history (${goldCurrency}): ${err instanceof Error ? err.message : String(err)}`,
      );
      xauCandles = [];
    }
    if (xauCandles.length > 0) {
      xauSpotHistory = new Map(xauCandles.map((c) => [c.date, c.close]));
    }
  }

  for (const instr of instrRows) {
    const firstHeld = txRows
      .filter((r) => r.instrumentId === instr.id)
      .reduce((min, r) => (r.executedAt < min ? r.executedAt : min), txRows[0]!.executedAt);
    const firstHeldDate = toDateKey(firstHeld);
    const fetchFrom = firstHeldDate < startDate ? startDate : firstHeldDate;

    const instrPrices = new Map<string, { close: string; currency: string }>();
    rawPrices.set(instr.id, instrPrices);

    if (instr.assetClass === "bond") {
      // When a manual price is set, skip this bond entirely — the manual price
      // row is the only meaningful data point, and writing par rows would
      // overwrite it (or any historical manual rows from a previous set) via
      // onConflictDoUpdate. Backfill will regenerate the full par history once
      // the manual price is cleared.
      if (instr.manualPrice && Number(instr.manualPrice) > 0) {
        continue;
      }
      if (instr.faceValue) {
        const d = new Date(fetchFrom);
        const end = new Date(today);
        while (d <= end) {
          const ds = toDateKey(d);
          instrPrices.set(ds, { close: instr.faceValue, currency: instr.currency });
          d.setUTCDate(d.getUTCDate() + 1);
        }
      }
      continue;
    }

    if (instr.assetClass === "mutual_fund") {
      const navRow = await db
        .select()
        .from(scrapedQuotes)
        .where(eq(scrapedQuotes.key, `nav:${instr.symbol}`))
        .limit(1);
      if (navRow[0]) {
        const nav = navRow[0].value;
        const d = new Date(fetchFrom);
        const end = new Date(today);
        while (d <= end) {
          const ds = toDateKey(d);
          instrPrices.set(ds, { close: nav, currency: instr.currency });
          d.setUTCDate(d.getUTCDate() + 1);
        }
      }
      continue;
    }

    if (instr.assetClass === "gold" && (instr.market === "ANTAM" || instr.market === "GALERI24")) {
      const todayBuyback = goldBuybackByMarket.get(instr.market);
      if (!todayBuyback || !xauSpotHistory) continue;

      const todaySpot = xauSpotHistory.get(today);
      if (!todaySpot || Number(todaySpot) === 0) continue;

      const k = new Decimal(todayBuyback).div(new Decimal(todaySpot));
      for (const [date, spot] of xauSpotHistory) {
        if (date < fetchFrom) continue;
        const proxyClose = k.mul(new Decimal(spot)).toString();
        instrPrices.set(date, { close: proxyClose, currency: instr.currency });
      }
      continue;
    }

    const ref: InstrumentRef = {
      symbol: instr.symbol,
      market: instr.market,
      assetClass: instr.assetClass as InstrumentRef["assetClass"],
      currency: instr.currency,
      isin: instr.isin ?? undefined,
    };

    // A tail-only heal's `fetchFrom` window is deliberately short (the gap since the last
    // known price) — an empty result there means "no new candles since then", not "this
    // instrument has no history". `allowMaxFallback: false` suppresses
    // MarketDataService.getHistoryFrom's own internal full-range fallback in that case;
    // falling back to a full-range fetch on every such miss is what let a permanently
    // dead feed re-trigger an unbounded provider call every sweep run (issue #737). Only
    // a from-inception heal wants the max-range fallback.
    let candles: Candle[];
    let fetchError: Error | null = null;
    try {
      candles = await marketData.getHistoryFrom(ref, fetchFrom, {
        allowMaxFallback: !opts.tailOnly,
      });
    } catch (err) {
      // Issue #749 — a throw here (network error, rate limit, auth failure) is a
      // fundamentally different failure mode from "provider resolved with []": the
      // former is a transient outage, the latter is a feed with nothing to give.
      // Pre-#749 this branch collapsed into the empty-result path via `.catch(() => [])`,
      // so a feed that had been erroring for a week got the same dead-feed cooldown
      // treatment as a truly delisted one. Track the two paths separately.
      fetchError = err instanceof Error ? err : new Error(String(err));
      candles = [];
    }

    if (candles.length === 0 && !fetchError) {
      unpriced.push(instr.id);
      // Plain human-readable line, deliberately NOT JSON — a hand-rolled object with a
      // string `level` field looks like a pino log line but isn't one (pino's own
      // `level` is numeric), so a log pipeline filtering on `level >= 40` would silently
      // drop it. This function has no logger threaded through it (called from contexts
      // that range from the scheduler, which has one, to direct test calls, which don't),
      // so a plain console.warn is the honest option rather than a line that fakes being
      // structured without actually being parseable as such.
      console.warn(
        `[backfill] no price history for instrument ${instr.id} (${instr.symbol}/${instr.market}, tailOnly=${opts.tailOnly ?? false}); skipping`,
      );
    } else if (fetchError) {
      unpriced.push(instr.id);
      console.warn(
        `[backfill] provider error for instrument ${instr.id} (${instr.symbol}/${instr.market}): ${fetchError.message}; skipping`,
      );
    } else {
      const earliest = candles[0]!.date;
      if (earliest > firstHeldDate) {
        truncated.push(instr.id);
      }
      for (const c of candles) {
        if (c.date >= fetchFrom) {
          instrPrices.set(c.date, { close: c.close, currency: instr.currency });
        }
      }
    }

    // Atomic increment (not read-then-write instr.priceFeedMissCount + 1) — two
    // backfill-portfolio workers processing different portfolios that happen to share
    // this instrument (a common ETF/mutual fund) could otherwise both read the same
    // starting count and last-write-wins, under-counting the miss streak.
    //
    // priceFeedMissCount counts ALL failures (throw or empty result) — this is the
    // counter that feeds the dead-feed cooldown. A feed alternating throw/miss must
    // reach DEAD_FEED_MISS_THRESHOLD as fast as one that's consistently failing one
    // way; pre-#749 everything went through the same `[]` path, so the total failure
    // count was already the right number. Splitting the bookkeeping (error count =
    // observability only) without changing the total keeps the threshold semantics
    // unchanged (issue #749).
    //
    // priceFeedErrorCount tracks only the throw path for operational visibility —
    // it's not used by the cooldown decision, but it tells an operator at a glance
    // whether the failures are network/HTTP errors vs. legitimately empty feeds.
    await db
      .update(instruments)
      .set(
        candles.length > 0
          ? {
              priceFeedMissCount: 0,
              priceFeedLastMissAt: null,
              priceFeedErrorCount: 0,
              priceFeedLastErrorAt: null,
            }
          : {
              priceFeedMissCount: sql`${instruments.priceFeedMissCount} + 1`,
              priceFeedLastMissAt: new Date(),
              ...(fetchError
                ? {
                    priceFeedErrorCount: sql`${instruments.priceFeedErrorCount} + 1`,
                    priceFeedLastErrorAt: new Date(),
                  }
                : {}),
            },
      )
      .where(eq(instruments.id, instr.id));
  }

  if (instrIds.length > 0) {
    try {
      const { refreshDividends } = await import("../dividends.js");
      await refreshDividends(db, marketData, new Date());
    } catch {
      // non-fatal
    }
  }

  const divEventRows = instrIds.length
    ? await db.select().from(dividendEvents).where(inArray(dividendEvents.instrumentId, instrIds))
    : [];
  const divEventsByInstr = new Map<
    string,
    { exDate: string; payDate: string | null; amountPerShare: string }[]
  >();
  for (const row of divEventRows) {
    const list = divEventsByInstr.get(row.instrumentId) ?? [];
    list.push({
      exDate: row.exDate,
      payDate: row.payDate ?? null,
      amountPerShare: row.amountPerShare,
    });
    divEventsByInstr.set(row.instrumentId, list);
  }

  function flowDateOf(tx: {
    instrumentId: string | null;
    type: string;
    price: string;
    executedAt: Date;
  }): string {
    const payDate = toDateKey(tx.executedAt);
    if ((tx.type === "dividend" || tx.type === "coupon") && tx.instrumentId) {
      const events = divEventsByInstr.get(tx.instrumentId) ?? [];
      const payMs = tx.executedAt.getTime();
      let bestMatch: { exDate: string } | null = null;
      let bestDelta = Infinity;
      for (const ev of events) {
        if (ev.payDate) {
          const delta = Math.abs(new Date(ev.payDate).getTime() - payMs);
          if (delta < bestDelta && delta < 7 * 86_400_000) {
            bestDelta = delta;
            bestMatch = ev;
          }
        }
        if (!bestMatch && ev.amountPerShare === tx.price) {
          bestMatch = ev;
        }
      }
      if (bestMatch) return bestMatch.exDate;
    }
    return payDate;
  }

  for (const [instrId, dateMap] of rawPrices) {
    for (const [date, { close, currency }] of dateMap) {
      await db
        .insert(prices)
        .values({ instrumentId: instrId, date, close, currency })
        .onConflictDoUpdate({
          target: [prices.instrumentId, prices.date],
          set: { close, currency },
        });
    }
  }

  const dateGrid: string[] = [];
  const d = new Date(startDate);
  const endDate = new Date(today);
  while (d <= endDate) {
    dateGrid.push(toDateKey(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const allCurrencies = [...new Set(instrRows.map((i) => i.currency))];
  const txCurrencies = [...new Set(txRows.map((r) => r.currency))];
  const allCcys = [...new Set([...allCurrencies, ...txCurrencies])];

  const [pfRow] = await db
    .select({ baseCurrency: (await import("@portfolio/db")).portfolios.baseCurrency })
    .from((await import("@portfolio/db")).portfolios)
    .where(eq((await import("@portfolio/db")).portfolios.id, portfolioId))
    .limit(1);
  const baseCurrency = pfRow?.baseCurrency ?? "IDR";

  const fxByDate = await getFxRatesForDates(db, allCcys, baseCurrency, dateGrid);

  function kindOf(instrId: string): PriceSeriesKind {
    const instr = instrById.get(instrId);
    if (!instr) return "none";
    if (instr.assetClass === "bond" || instr.assetClass === "mutual_fund") return "flatProxy";
    return "realSeries";
  }

  // Forward-fill each instrument's sparse raw candles across the full date grid, but
  // bounded to MAX_PRICE_CARRY_FORWARD_DAYS (issue #744) — beyond that, a carried price
  // is a stale artifact, not a plausible value, so the fill lapses and priceAt returns
  // null again (same threshold the live/daily valuation path uses, see
  // services/valuation.ts). earliestPricedDate tracks the first RAW (un-filled) candle
  // per instrument, so hasEverPriced below can distinguish "never priced at all" (cost
  // fallback) from "priced before, but this particular gap exceeds the carry-forward
  // bound" (excluded from MV, unchanged from pre-#744 behavior — see buildDailyValueFlows'
  // hasEverPriced doc comment for why the two are NOT treated the same).
  const filledPrices = new Map<string, Map<string, { close: string; currency: string }>>();
  const earliestPricedDate = new Map<string, string>();
  for (const [instrId, dateMap] of rawPrices) {
    const sortedRawDates = [...dateMap.keys()].sort();
    if (sortedRawDates.length > 0) earliestPricedDate.set(instrId, sortedRawDates[0]!);

    const filled = new Map<string, { close: string; currency: string }>();
    let last: { close: string; currency: string } | null = null;
    let lastMs = 0;
    for (const date of dateGrid) {
      const candle = dateMap.get(date);
      if (candle) {
        last = candle;
        lastMs = new Date(`${date}T00:00:00.000Z`).getTime();
      }
      if (!last) continue;
      const daysSince = (new Date(`${date}T00:00:00.000Z`).getTime() - lastMs) / 86_400_000;
      if (daysSince <= MAX_PRICE_CARRY_FORWARD_DAYS) filled.set(date, last);
    }
    filledPrices.set(instrId, filled);
  }

  function hasEverPriced(instrId: string, date: string): boolean {
    const earliest = earliestPricedDate.get(instrId);
    return earliest !== undefined && earliest <= date;
  }

  function priceAt(instrId: string, date: string): { close: string; currency: string } | null {
    const filled = filledPrices.get(instrId);
    if (!filled) return null;
    const raw = filled.get(date);
    if (!raw) return null;
    const factor = splitAdjustmentFactor(coreCas, instrId, date);
    if (factor.isZero() || factor.isNaN()) return raw;
    return { close: new Decimal(raw.close).div(factor).toString(), currency: raw.currency };
  }

  function fxAt(date: string) {
    return makeFxRateFn(fxByDate.get(date) ?? {}, baseCurrency);
  }

  const coreTxns = toCoreTxns(txRows);

  const dailyFlows = buildDailyValueFlows({
    transactions: coreTxns,
    corporateActions: coreCas,
    dates: dateGrid,
    priceAt,
    hasEverPriced,
    fxAt,
    baseCurrency,
    kindOf,
    flowDateOf: (tx) => flowDateOf(tx),
  });

  let count = 0;
  for (const flow of dailyFlows) {
    const asOf = new Date(`${flow.date}T23:59:59.999Z`);
    const holdingsAtDate = computeHoldings(coreTxns, coreCas, asOf);
    const pricesForDate: Record<string, { price: string; currency: string }> = {};
    for (const h of holdingsAtDate) {
      const p = priceAt(h.instrumentId, flow.date);
      if (p) pricesForDate[h.instrumentId] = { price: p.close, currency: p.currency };
    }
    const cash = cashCounted ? cashBalances(coreTxns.filter((t) => t.executedAt <= asOf)) : {};
    const fx = fxAt(flow.date);
    const nw = netWorth({
      holdings: holdingsAtDate,
      prices: pricesForDate,
      cash,
      displayCurrency: baseCurrency,
      fx,
      hasEverPriced: (instrId) => hasEverPriced(instrId, flow.date),
    });

    await db
      .insert(portfolioSnapshots)
      .values({
        portfolioId,
        date: flow.date,
        netWorth: nw,
        marketValue: flow.marketValue,
        effectiveFlow: flow.effectiveFlow,
        currency: baseCurrency,
      })
      .onConflictDoUpdate({
        target: [portfolioSnapshots.portfolioId, portfolioSnapshots.date],
        set: {
          netWorth: nw,
          marketValue: flow.marketValue,
          effectiveFlow: flow.effectiveFlow,
          currency: baseCurrency,
        },
      });
    count++;
  }

  return { instruments: instrRows.length, days: count, truncated, unpriced };
}

/**
 * Compute portfolio snapshots from prices already in the DB. Used by the
 * planner/sub-job pattern (#761): after all per-instrument sub-jobs have
 * written their prices, this function reads them back and computes the
 * full snapshot series. Also usable standalone for non-planner backfills.
 */
export async function computeBackfillSnapshots(
  db: DB,
  portfolioId: string,
  opts: { fromDate?: string } = {},
): Promise<BackfillResult> {
  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolioId));

  if (txRows.length === 0) return { instruments: 0, days: 0, truncated: [], unpriced: [] };

  const [pf] = await db
    .select({ cashCounted: portfolios.cashCounted })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1);
  const cashCounted = pf?.cashCounted ?? true;

  const inceptionMs = Math.min(...txRows.map((r) => r.executedAt.getTime()));
  const inceptionDate = toDateKey(new Date(inceptionMs));
  const startDate = opts.fromDate && opts.fromDate > inceptionDate ? opts.fromDate : inceptionDate;
  const today = toDateKey(new Date());

  if (startDate > today) return { instruments: 0, days: 0, truncated: [], unpriced: [] };

  const instrIds = [
    ...new Set(txRows.map((r) => r.instrumentId).filter((x): x is string => x !== null)),
  ];
  const instrRows = instrIds.length
    ? await db.select().from(instruments).where(inArray(instruments.id, instrIds))
    : [];
  const instrById = new Map(instrRows.map((i) => [i.id, i]));

  const caRows = instrIds.length
    ? await db
        .select()
        .from(corporateActions)
        .where(inArray(corporateActions.instrumentId, instrIds))
    : [];
  const coreCas = caRows.map((r) => ({
    instrumentId: r.instrumentId,
    type: r.type as "split" | "bonus" | "rights",
    ratio: r.ratio,
    exDate: new Date(r.exDate),
  }));

  const truncated: string[] = [];
  const unpriced: string[] = [];
  const rawPrices = new Map<string, Map<string, { close: string; currency: string }>>();

  // Read prices from DB (already written by sub-jobs or inline backfill)
  for (const instr of instrRows) {
    const priceRows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));

    const instrPrices = new Map<string, { close: string; currency: string }>();
    rawPrices.set(instr.id, instrPrices);

    let firstPricedDate: string | null = null;
    for (const row of priceRows) {
      if (row.date >= startDate) {
        instrPrices.set(row.date, { close: row.close, currency: row.currency });
      }
      if (!firstPricedDate || row.date < firstPricedDate) {
        firstPricedDate = row.date;
      }
    }

    // Check truncation: first-priced after first-held
    const firstHeld = txRows
      .filter((r) => r.instrumentId === instr.id)
      .reduce((min, r) => (r.executedAt < min ? r.executedAt : min), txRows[0]!.executedAt);
    const firstHeldDate = toDateKey(firstHeld);
    if (firstPricedDate && firstPricedDate > firstHeldDate) {
      truncated.push(instr.id);
    }
    if (instrPrices.size === 0) {
      unpriced.push(instr.id);
    }
  }

  // Refresh dividends (non-fatal)
  if (instrIds.length > 0) {
    try {
      const { refreshDividends } = await import("../dividends.js");
      const { getMarketData } = await import("../market-data.js");
      await refreshDividends(db, await getMarketData(), new Date());
    } catch {
      // non-fatal
    }
  }

  const divEventRows = instrIds.length
    ? await db.select().from(dividendEvents).where(inArray(dividendEvents.instrumentId, instrIds))
    : [];
  const divEventsByInstr = new Map<
    string,
    { exDate: string; payDate: string | null; amountPerShare: string }[]
  >();
  for (const row of divEventRows) {
    const list = divEventsByInstr.get(row.instrumentId) ?? [];
    list.push({
      exDate: row.exDate,
      payDate: row.payDate ?? null,
      amountPerShare: row.amountPerShare,
    });
    divEventsByInstr.set(row.instrumentId, list);
  }

  function flowDateOf(tx: {
    instrumentId: string | null;
    type: string;
    price: string;
    executedAt: Date;
  }): string {
    const payDate = toDateKey(tx.executedAt);
    if ((tx.type === "dividend" || tx.type === "coupon") && tx.instrumentId) {
      const events = divEventsByInstr.get(tx.instrumentId) ?? [];
      const payMs = tx.executedAt.getTime();
      let bestMatch: { exDate: string } | null = null;
      let bestDelta = Infinity;
      for (const ev of events) {
        if (ev.payDate) {
          const delta = Math.abs(new Date(ev.payDate).getTime() - payMs);
          if (delta < bestDelta && delta < 7 * 86_400_000) {
            bestDelta = delta;
            bestMatch = ev;
          }
        }
        if (!bestMatch && ev.amountPerShare === tx.price) {
          bestMatch = ev;
        }
      }
      if (bestMatch) return bestMatch.exDate;
    }
    return payDate;
  }

  const dateGrid: string[] = [];
  const d = new Date(startDate);
  const endDate = new Date(today);
  while (d <= endDate) {
    dateGrid.push(toDateKey(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const allCurrencies = [...new Set(instrRows.map((i) => i.currency))];
  const txCurrencies = [...new Set(txRows.map((r) => r.currency))];
  const allCcys = [...new Set([...allCurrencies, ...txCurrencies])];

  const [pfRow] = await db
    .select({ baseCurrency: (await import("@portfolio/db")).portfolios.baseCurrency })
    .from((await import("@portfolio/db")).portfolios)
    .where(eq((await import("@portfolio/db")).portfolios.id, portfolioId))
    .limit(1);
  const baseCurrency = pfRow?.baseCurrency ?? "IDR";

  const fxByDate = await getFxRatesForDates(db, allCcys, baseCurrency, dateGrid);

  function kindOf(instrId: string): PriceSeriesKind {
    const instr = instrById.get(instrId);
    if (!instr) return "none";
    if (instr.assetClass === "bond" || instr.assetClass === "mutual_fund") return "flatProxy";
    return "realSeries";
  }

  const filledPrices = new Map<string, Map<string, { close: string; currency: string }>>();
  const earliestPricedDate = new Map<string, string>();
  for (const [instrId, dateMap] of rawPrices) {
    const sortedRawDates = [...dateMap.keys()].sort();
    if (sortedRawDates.length > 0) earliestPricedDate.set(instrId, sortedRawDates[0]!);

    const filled = new Map<string, { close: string; currency: string }>();
    let last: { close: string; currency: string } | null = null;
    let lastMs = 0;
    for (const date of dateGrid) {
      const candle = dateMap.get(date);
      if (candle) {
        last = candle;
        lastMs = new Date(`${date}T00:00:00.000Z`).getTime();
      }
      if (!last) continue;
      const daysSince = (new Date(`${date}T00:00:00.000Z`).getTime() - lastMs) / 86_400_000;
      if (daysSince <= MAX_PRICE_CARRY_FORWARD_DAYS) filled.set(date, last);
    }
    filledPrices.set(instrId, filled);
  }

  function hasEverPriced(instrId: string, date: string): boolean {
    const earliest = earliestPricedDate.get(instrId);
    return earliest !== undefined && earliest <= date;
  }

  function priceAt(instrId: string, date: string): { close: string; currency: string } | null {
    const filled = filledPrices.get(instrId);
    if (!filled) return null;
    const raw = filled.get(date);
    if (!raw) return null;
    const factor = splitAdjustmentFactor(coreCas, instrId, date);
    if (factor.isZero() || factor.isNaN()) return raw;
    return { close: new Decimal(raw.close).div(factor).toString(), currency: raw.currency };
  }

  function fxAt(date: string) {
    return makeFxRateFn(fxByDate.get(date) ?? {}, baseCurrency);
  }

  const coreTxns = toCoreTxns(txRows);

  const dailyFlows = buildDailyValueFlows({
    transactions: coreTxns,
    corporateActions: coreCas,
    dates: dateGrid,
    priceAt,
    hasEverPriced,
    fxAt,
    baseCurrency,
    kindOf,
    flowDateOf: (tx) => flowDateOf(tx),
  });

  let count = 0;
  for (const flow of dailyFlows) {
    const asOf = new Date(`${flow.date}T23:59:59.999Z`);
    const holdingsAtDate = computeHoldings(coreTxns, coreCas, asOf);
    const pricesForDate: Record<string, { price: string; currency: string }> = {};
    for (const h of holdingsAtDate) {
      const p = priceAt(h.instrumentId, flow.date);
      if (p) pricesForDate[h.instrumentId] = { price: p.close, currency: p.currency };
    }
    const cash = cashCounted ? cashBalances(coreTxns.filter((t) => t.executedAt <= asOf)) : {};
    const fx = fxAt(flow.date);
    const nw = netWorth({
      holdings: holdingsAtDate,
      prices: pricesForDate,
      cash,
      displayCurrency: baseCurrency,
      fx,
      hasEverPriced: (instrId) => hasEverPriced(instrId, flow.date),
    });

    await db
      .insert(portfolioSnapshots)
      .values({
        portfolioId,
        date: flow.date,
        netWorth: nw,
        marketValue: flow.marketValue,
        effectiveFlow: flow.effectiveFlow,
        currency: baseCurrency,
      })
      .onConflictDoUpdate({
        target: [portfolioSnapshots.portfolioId, portfolioSnapshots.date],
        set: {
          netWorth: nw,
          marketValue: flow.marketValue,
          effectiveFlow: flow.effectiveFlow,
          currency: baseCurrency,
        },
      });
    count++;
  }

  return { instruments: instrRows.length, days: count, truncated, unpriced };
}
