import { eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
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
  type PriceSeriesKind,
} from "@portfolio/core";
import type { InstrumentRef, MarketDataService } from "@portfolio/market-data";
import type { DB } from "../../db/client.js";
import { toCoreTxns } from "../tx-core.js";
import { getFxRatesForDates, makeFxRateFn } from "../fx.js";

export interface BackfillOptions {
  /** Only recompute snapshots on or after this date (ISO YYYY-MM-DD). */
  fromDate?: string;
}

export interface BackfillResult {
  instruments: number;
  days: number;
  truncated: string[];
}

export async function backfillPortfolioHistory(
  db: DB,
  marketData: MarketDataService,
  _ttlMs: number,
  portfolioId: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolioId));

  if (txRows.length === 0) return { instruments: 0, days: 0, truncated: [] };

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

  if (startDate > today) return { instruments: 0, days: 0, truncated: [] };

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
    const xauCandles = await marketData.getHistoryFrom(xauRef, startDate).catch(() => []);
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

    let candles = await marketData.getHistoryFrom(ref, fetchFrom).catch(() => []);
    if (candles.length === 0) {
      candles = await marketData.getHistory(ref, "max").catch(() => []);
    }

    if (candles.length === 0) {
      console.warn(
        `[backfill] no price history for instrument ${instr.id} (${instr.symbol}/${instr.market}); skipping`,
      );
    }

    if (candles.length > 0) {
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

  const filledPrices = new Map<string, Map<string, { close: string; currency: string }>>();
  for (const [instrId, dateMap] of rawPrices) {
    const filled = new Map<string, { close: string; currency: string }>();
    let last: { close: string; currency: string } | null = null;
    for (const date of dateGrid) {
      const candle = dateMap.get(date);
      if (candle) last = candle;
      if (last) filled.set(date, last);
    }
    filledPrices.set(instrId, filled);
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

  return { instruments: instrRows.length, days: count, truncated };
}
