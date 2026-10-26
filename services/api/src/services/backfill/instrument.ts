import { upsertPriceRows } from "./price-upsert.js";
import { eq, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { MAX_PRICE_CARRY_FORWARD_DAYS } from "@portfolio/core";
import { instruments, scrapedQuotes } from "@portfolio/db";
import type { Candle, InstrumentRef, MarketDataService } from "@portfolio/market-data";
import type { DB } from "../../db/client.js";
import { buybackKeyFor, isBuybackGoldMarket } from "../scrapers/store.js";
import { firstHeldDateFor, isManualPriceBond, priceGapRemains } from "./shared.js";

export interface InstrumentChunkData {
  portfolioId: string;
  instrumentId: string;
  chunkStart: string;
  chunkEnd: string;
  /**
   * This is a trailing-edge-only heal — see BackfillOptions.tailOnly in core.ts for the
   * full rationale (issue #737). Must be threaded through from the planner: an empty
   * fetch result on a short tail window means "no new candles since then," not "this
   * instrument has no history," and falling back to a full-range fetch on every such
   * miss is what let a permanently dead feed re-trigger an unbounded provider call on
   * every sweep run.
   */
  tailOnly?: boolean;
}

export interface InstrumentChunkResult {
  instrumentId: string;
  days: number;
  truncated: boolean;
  unpriced: boolean;
}

/**
 * Fetch prices for a single instrument within a date range and write them to
 * the `prices` table. This is the per-instrument sub-job used by the
 * backfill planner pattern (#761).
 *
 * Handles asset-class-specific logic:
 * - bonds: par prices from faceValue (skipped if manualPrice is set)
 * - mutual_fund: scraped NAV from scraped_quotes
 * - gold (ANTAM/GALERI24): XAU spot proxy
 * - regular instruments: market data provider candles
 *
 * Returns the number of price days written, plus truncation/unpriced flags.
 */
export async function fetchInstrumentPrices(
  db: DB,
  marketData: MarketDataService,
  data: InstrumentChunkData,
): Promise<InstrumentChunkResult> {
  const { portfolioId, instrumentId, chunkStart, chunkEnd, tailOnly } = data;

  const [instr] = await db
    .select()
    .from(instruments)
    .where(eq(instruments.id, instrumentId))
    .limit(1);

  if (!instr) {
    return { instrumentId, days: 0, truncated: false, unpriced: true };
  }

  const instrPrices = new Map<string, { close: string; currency: string }>();

  if (instr.assetClass === "bond") {
    if (isManualPriceBond(instr)) {
      return { instrumentId, days: 0, truncated: false, unpriced: false };
    }
    if (instr.faceValue) {
      const d = new Date(chunkStart);
      const end = new Date(chunkEnd);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        instrPrices.set(ds, { close: instr.faceValue, currency: instr.currency });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    const days = instrPrices.size;
    await upsertPriceRows(
      db,
      [...instrPrices].map(([date, { close, currency }]) => ({
        instrumentId,
        date,
        close,
        currency,
      })),
    );
    return { instrumentId, days, truncated: false, unpriced: false };
  }

  if (instr.assetClass === "mutual_fund") {
    const navRow = await db
      .select()
      .from(scrapedQuotes)
      .where(eq(scrapedQuotes.key, `nav:${instr.symbol}`))
      .limit(1);
    if (navRow[0]) {
      const nav = navRow[0].value;
      const d = new Date(chunkStart);
      const end = new Date(chunkEnd);
      while (d <= end) {
        const ds = d.toISOString().slice(0, 10);
        instrPrices.set(ds, { close: nav, currency: instr.currency });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    const days = instrPrices.size;
    await upsertPriceRows(
      db,
      [...instrPrices].map(([date, { close, currency }]) => ({
        instrumentId,
        date,
        close,
        currency,
      })),
    );
    return { instrumentId, days, truncated: false, unpriced: days === 0 };
  }

  if (instr.assetClass === "gold" && isBuybackGoldMarket(instr.market)) {
    // Fetch XAU spot history and compute buyback proxy
    const goldCurrency = instr.currency;
    const xauRef: InstrumentRef = {
      symbol: `XAU${goldCurrency}`,
      market: "XAU",
      assetClass: "gold",
      currency: goldCurrency,
    };

    let xauCandles: Candle[];
    try {
      xauCandles = await marketData.getHistoryFrom(xauRef, chunkStart);
    } catch (err) {
      console.warn(
        `[backfill] provider error fetching XAU spot history (${goldCurrency}): ${err instanceof Error ? err.message : String(err)}`,
      );
      xauCandles = [];
    }
    if (xauCandles.length === 0) {
      return { instrumentId, days: 0, truncated: false, unpriced: true };
    }

    const xauSpotHistory = new Map(xauCandles.map((c) => [c.date, c.close]));

    // Get buyback rate for today
    const buybackKey = buybackKeyFor(instr.market);
    if (!buybackKey) return { instrumentId, days: 0, truncated: false, unpriced: true };
    const buybackRow = await db
      .select()
      .from(scrapedQuotes)
      .where(eq(scrapedQuotes.key, buybackKey))
      .limit(1);

    const today = new Date().toISOString().slice(0, 10);
    const todayBuyback = buybackRow[0]?.value;
    const todaySpot = xauSpotHistory.get(today);
    if (!todayBuyback || !todaySpot || Number(todaySpot) === 0) {
      return { instrumentId, days: 0, truncated: false, unpriced: true };
    }

    const k = new Decimal(todayBuyback).div(new Decimal(todaySpot));
    for (const [date, spot] of xauSpotHistory) {
      if (date < chunkStart || date > chunkEnd) continue;
      const proxyClose = k.mul(new Decimal(spot)).toString();
      instrPrices.set(date, { close: proxyClose, currency: instr.currency });
    }

    const days = instrPrices.size;
    await upsertPriceRows(
      db,
      [...instrPrices].map(([date, { close, currency }]) => ({
        instrumentId,
        date,
        close,
        currency,
      })),
    );
    return { instrumentId, days, truncated: false, unpriced: days === 0 };
  }

  // Regular instrument — fetch from market data provider
  const ref: InstrumentRef = {
    symbol: instr.symbol,
    market: instr.market,
    assetClass: instr.assetClass as InstrumentRef["assetClass"],
    currency: instr.currency,
    isin: instr.isin ?? undefined,
  };

  // Get the first-held date for this instrument, scoped to THIS portfolio, to detect
  // truncation — an instrument held by multiple portfolios must not have one
  // portfolio's truncation flag answer "when was this held by ANY portfolio."
  const firstHeldKey = (await firstHeldDateFor(db, portfolioId, instrumentId)) ?? chunkStart;

  let candles: Candle[];
  let fetchError: Error | null = null;
  try {
    // See InstrumentChunkData.tailOnly's doc comment — mirrors core.ts's inline path
    // (`allowMaxFallback: !opts.tailOnly`).
    candles = await marketData.getHistoryFrom(ref, chunkStart, {
      allowMaxFallback: !tailOnly,
      gapFillDays: MAX_PRICE_CARRY_FORWARD_DAYS, // see core.ts
    });
  } catch (err) {
    fetchError = err instanceof Error ? err : new Error(String(err));
    candles = [];
  }

  if (candles.length === 0 && !fetchError) {
    await db
      .update(instruments)
      .set({
        priceFeedMissCount: sql`${instruments.priceFeedMissCount} + 1`,
        priceFeedLastMissAt: new Date(),
      })
      .where(eq(instruments.id, instrumentId));
    return { instrumentId, days: 0, truncated: false, unpriced: true };
  }

  if (fetchError) {
    await db
      .update(instruments)
      .set({
        priceFeedMissCount: sql`${instruments.priceFeedMissCount} + 1`,
        priceFeedLastMissAt: new Date(),
        priceFeedErrorCount: sql`${instruments.priceFeedErrorCount} + 1`,
        priceFeedLastErrorAt: new Date(),
      })
      .where(eq(instruments.id, instrumentId));
    return { instrumentId, days: 0, truncated: false, unpriced: true };
  }

  const truncated = candles[0]!.date > firstHeldKey;
  for (const c of candles) {
    if (c.date >= chunkStart && c.date <= chunkEnd) {
      // Provider currency wins over the instrument's declared one (see core.ts).
      instrPrices.set(c.date, { close: c.close, currency: c.currency ?? instr.currency });
    }
  }

  const days = instrPrices.size;
  await upsertPriceRows(
    db,
    [...instrPrices].map(([date, { close, currency }]) => ({
      instrumentId,
      date,
      close,
      currency,
    })),
  );

  // Candles with a hole longer than the carry-forward window left in the series are still
  // a miss (see priceGapRemains) — count it for the dead-feed cooldown instead of
  // resetting, but this is not an error.
  const gapRemains = await priceGapRemains(
    db,
    instrumentId,
    chunkStart,
    [...instrPrices.keys()],
    chunkEnd, // a chunked run only owns its own window; don't call the stretch after it a gap
  );
  await db
    .update(instruments)
    .set(
      gapRemains
        ? {
            priceFeedMissCount: sql`${instruments.priceFeedMissCount} + 1`,
            priceFeedLastMissAt: new Date(),
            // The fetch itself didn't throw, so a stale error streak is not current.
            priceFeedErrorCount: 0,
            priceFeedLastErrorAt: null,
          }
        : {
            priceFeedMissCount: 0,
            priceFeedLastMissAt: null,
            priceFeedErrorCount: 0,
            priceFeedLastErrorAt: null,
          },
    )
    .where(eq(instruments.id, instrumentId));

  return { instrumentId, days, truncated, unpriced: false };
}
