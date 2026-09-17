import { eq, inArray, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { instruments, prices, scrapedQuotes } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type { Candle, InstrumentRef, MarketDataService } from "@portfolio/market-data";
import type { DB } from "../../db/client.js";
import {
  loadBackfillContext,
  firstHeldDateFrom,
  isManualPriceBond,
  laterDateKey,
} from "./shared.js";
import { buildFlowDateFn, writeSnapshotSeries, type RawPriceMap } from "./snapshots.js";

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
}

export interface BackfillResult {
  instruments: number;
  days: number;
  /** Instruments whose earliest available candle is later than their first-held date. */
  truncated: string[];
  /** Instruments for which no price candle could be found at all this run. */
  unpriced: string[];
}

export async function backfillPortfolioHistory(
  db: DB,
  marketData: MarketDataService,
  _ttlMs: number,
  portfolioId: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const ctx = await loadBackfillContext(db, portfolioId, opts);
  if (!ctx) return { instruments: 0, days: 0, truncated: [], unpriced: [] };
  const { txRows, startDate, today, instrIds, instrRows } = ctx;

  const truncated: string[] = [];
  const unpriced: string[] = [];
  const rawPrices: RawPriceMap = new Map();

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
    const firstHeldDate = firstHeldDateFrom(txRows, instr.id) ?? startDate;
    const fetchFrom = laterDateKey(firstHeldDate, startDate);

    const instrPrices = new Map<string, { close: string; currency: string }>();
    rawPrices.set(instr.id, instrPrices);

    if (instr.assetClass === "bond") {
      // When a manual price is set, skip this bond entirely — the manual price
      // row is the only meaningful data point, and writing par rows would
      // overwrite it (or any historical manual rows from a previous set) via
      // onConflictDoUpdate. Backfill will regenerate the full par history once
      // the manual price is cleared.
      if (isManualPriceBond(instr)) {
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

  // Merge in previously-persisted prices for dates this run's fetch didn't refresh
  // (issue #775). A candle fetch above only covers THIS run — on a dead feed
  // (candles.length === 0) `rawPrices` for that instrument stays entirely empty, even
  // when an earlier successful run already wrote real price rows for it. Without this
  // merge, writeSnapshotSeries' `hasEverPriced` would see "never priced at all" and
  // fall back to cost basis immediately, instead of carrying the stale-but-real price
  // forward (bounded by MAX_PRICE_CARRY_FORWARD_DAYS) the way `computeBackfillSnapshots`
  // (the fan-out path, which reads the full `prices` table) already does — see the
  // hasEverPriced doc comment in CLAUDE.md/writeSnapshotSeries for why collapsing that
  // distinction corrupts the TWR index. Only fills gaps: a date this run DID fetch keeps
  // its freshly-fetched value.
  for (const instr of instrRows) {
    if (instr.assetClass === "bond" && isManualPriceBond(instr)) continue;
    const instrPrices = rawPrices.get(instr.id);
    if (!instrPrices) continue;
    const priceRows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));
    for (const row of priceRows) {
      if (row.date < startDate) continue;
      if (!instrPrices.has(row.date)) {
        instrPrices.set(row.date, { close: row.close, currency: row.currency });
      }
    }
  }

  const flowDateOf = await buildFlowDateFn(db, instrIds);
  const days = await writeSnapshotSeries(db, ctx, rawPrices, flowDateOf);

  return { instruments: instrRows.length, days, truncated, unpriced };
}

/**
 * Compute portfolio snapshots from prices already in the DB. Used by the per-instrument
 * fan-out (#761/#773, see `backfill/fan-out.ts`'s `planFanOut`/`runFanOut`): after all
 * per-instrument sub-jobs have written their prices independently, the scheduler calls
 * this to read them back and compute the full snapshot series. (Contrast
 * `backfillPortfolioHistory` above, which fetches prices itself and merges them with its
 * own DB read-back before passing the combined `rawPrices` map to `writeSnapshotSeries` —
 * see the merge step there, issue #775, for why both paths must read the full `prices`
 * history rather than just this run's fetch.)
 */
export async function computeBackfillSnapshots(
  db: DB,
  portfolioId: string,
  opts: { fromDate?: string } = {},
): Promise<BackfillResult> {
  const ctx = await loadBackfillContext(db, portfolioId, opts);
  if (!ctx) return { instruments: 0, days: 0, truncated: [], unpriced: [] };
  const { txRows, startDate, instrIds, instrRows } = ctx;

  const truncated: string[] = [];
  const unpriced: string[] = [];
  const rawPrices: RawPriceMap = new Map();

  // Read prices from DB (already written by sub-jobs or inline backfill)
  for (const instr of instrRows) {
    const instrPrices = new Map<string, { close: string; currency: string }>();
    rawPrices.set(instr.id, instrPrices);

    // Mirror fetchInstrumentPrices/the inline path: a manually-priced bond writes
    // nothing new to `prices` for this run, so reading whatever is already in that
    // table here would pick up stale par-value rows left over from before the manual
    // price was set — silently overriding the user's manual price with generated par
    // history. Leave `instrPrices` empty; downstream valuation falls back to cost
    // basis for dates with no price, same as any other never-priced holding.
    const manualBond = isManualPriceBond(instr);

    let firstPricedDate: string | null = null;
    if (!manualBond) {
      const priceRows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));
      for (const row of priceRows) {
        if (row.date >= startDate) {
          instrPrices.set(row.date, { close: row.close, currency: row.currency });
        }
        if (!firstPricedDate || row.date < firstPricedDate) {
          firstPricedDate = row.date;
        }
      }
    }

    // Check truncation: first-priced after first-held
    const firstHeldDate = firstHeldDateFrom(txRows, instr.id);
    if (firstPricedDate && firstHeldDate && firstPricedDate > firstHeldDate) {
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

  const flowDateOf = await buildFlowDateFn(db, instrIds);
  const days = await writeSnapshotSeries(db, ctx, rawPrices, flowDateOf);

  return { instruments: instrRows.length, days, truncated, unpriced };
}
