import { eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { dividendEvents, portfolios, portfolioSnapshots } from "@portfolio/db";
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
import type { DB } from "../../db/client.js";
import { toCoreTxns } from "../tx-core.js";
import { getFxRatesForDates, makeFxRateFn } from "../fx.js";
import type { BackfillContext } from "./shared.js";

export type RawPriceMap = Map<string, Map<string, { close: string; currency: string }>>;

export type FlowDateFn = (tx: {
  instrumentId: string | null;
  type: string;
  price: string;
  executedAt: Date;
}) => string;

/**
 * Builds the dividend/coupon ex-date matcher shared by both snapshot-computing callers.
 * Deliberately does NOT call `refreshDividends` itself (that requires a `MarketDataService`
 * and each caller sources it differently — the inline path uses its injected instance, the
 * planner's `computeBackfillSnapshots` reaches for the module-singleton `getMarketData()` —
 * folding the refresh in here would silently pick a winner for both).
 */
export async function buildFlowDateFn(db: DB, instrIds: string[]): Promise<FlowDateFn> {
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

  return function flowDateOf(tx) {
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
  };
}

/**
 * Date grid → FX rates → bounded forward-fill (issue #744) → `buildDailyValueFlows` →
 * per-date `netWorth` → `portfolio_snapshots` upsert. The ~130-line tail shared by
 * `backfillPortfolioHistory`'s inline path and `computeBackfillSnapshots` — previously two
 * near-verbatim copies that had already diverged twice during review. Returns the number
 * of snapshot days written.
 */
export async function writeSnapshotSeries(
  db: DB,
  ctx: BackfillContext,
  rawPrices: RawPriceMap,
  flowDateOf: FlowDateFn,
): Promise<number> {
  const { portfolioId, txRows, cashCounted, startDate, today, instrRows, instrById, coreCas } = ctx;

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
    .select({ baseCurrency: portfolios.baseCurrency })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
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

  return count;
}
