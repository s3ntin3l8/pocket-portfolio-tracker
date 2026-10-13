import { eq, inArray, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { dividendEvents, portfolios, portfolioSnapshots } from "@portfolio/db";
import {
  buildDailyValueFlows,
  computeHoldings,
  netWorth,
  netWorthInputs,
  type Holding,
  splitAdjustmentFactor,
  toDateKey,
  MAX_PRICE_CARRY_FORWARD_DAYS,
  type PriceSeriesKind,
} from "@portfolio/core";
import type { DB } from "../../db/client.js";
import { chunk } from "../../lib/chunk.js";
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

  // Missing FX (audit B2): never write a 1:1 value. getFxRatesForDates carries a rate
  // forward/back over the whole grid, so a currency is either convertible on every day
  // or on none — a missing one means every day's value is incomplete, so the run writes
  // nothing (existing snapshots stay as they were) and logs once for the run, not per day.
  const fxMissing = allCcys.filter(
    (c) => c && c !== baseCurrency && !dateGrid.some((day) => fxByDate.get(day)?.[c]),
  );
  if (fxMissing.length > 0) {
    process.stderr.write(
      JSON.stringify({
        level: "warn",
        msg: "backfill skipped: FX rate missing",
        portfolioId,
        baseCurrency,
        missing: fxMissing.sort(),
        days: dateGrid.length,
      }) + "\n",
    );
    return 0;
  }

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

  // priceAt runs for every held instrument on every day (twice: flows + net worth), and
  // splitAdjustmentFactor scans every corporate action — memoize per (instrument, date).
  const factorCache = new Map<string, Decimal>();

  function priceAt(instrId: string, date: string): { close: string; currency: string } | null {
    const filled = filledPrices.get(instrId);
    if (!filled) return null;
    const raw = filled.get(date);
    if (!raw) return null;
    const factorKey = `${instrId}|${date}`;
    let factor = factorCache.get(factorKey);
    if (!factor) {
      factor = splitAdjustmentFactor(coreCas, instrId, date);
      factorCache.set(factorKey, factor);
    }
    if (factor.isZero() || factor.isNaN()) return raw;
    return { close: new Decimal(raw.close).div(factor).toString(), currency: raw.currency };
  }

  function fxAt(date: string) {
    return makeFxRateFn(fxByDate.get(date) ?? {}, baseCurrency);
  }

  const coreTxns = toCoreTxns(txRows);

  // buildDailyValueFlows already replays holdings for every date; capture them instead of
  // recomputing computeHoldings a second time per day below (audit D6).
  const holdingsByDate = new Map<string, Holding[]>();
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
    onHoldings: (date, holdings) => holdingsByDate.set(date, holdings),
  });

  // Transactions up to each day, via a moving prefix over a time-sorted copy instead of
  // re-filtering the whole history per day (issue #896). The sums netWorthInputs derives
  // (cash, liabilities) don't depend on row order.
  const txByTime = [...coreTxns].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  let txUpTo = 0;

  const rows: (typeof portfolioSnapshots.$inferInsert)[] = [];
  for (const flow of dailyFlows) {
    const asOf = new Date(`${flow.date}T23:59:59.999Z`);
    const holdingsAtDate =
      holdingsByDate.get(flow.date) ?? computeHoldings(coreTxns, coreCas, asOf);
    while (txUpTo < txByTime.length && txByTime[txUpTo]!.executedAt <= asOf) txUpTo++;
    const pricesForDate: Record<string, { price: string; currency: string }> = {};
    for (const h of holdingsAtDate) {
      const p = priceAt(h.instrumentId, flow.date);
      if (p) pricesForDate[h.instrumentId] = { price: p.close, currency: p.currency };
    }
    const fx = fxAt(flow.date);
    // Same cash/liabilities definition the live valuation writes into this row
    // (audit B6): cash only when inside the boundary AND tracked as of that day, loans
    // subtracted. FX is all-or-nothing for the run (checked above), so every currency
    // converts here.
    const { convertibleCash, liabilities } = netWorthInputs({
      transactions: txByTime.slice(0, txUpTo),
      cashCounted,
      displayCurrency: baseCurrency,
      fx,
    });
    const nw = netWorth({
      holdings: holdingsAtDate,
      prices: pricesForDate,
      cash: convertibleCash,
      liabilities,
      displayCurrency: baseCurrency,
      fx,
      hasEverPriced: (instrId) => hasEverPriced(instrId, flow.date),
    });

    rows.push({
      portfolioId,
      date: flow.date,
      netWorth: nw,
      marketValue: flow.marketValue,
      effectiveFlow: flow.effectiveFlow,
      currency: baseCurrency,
    });
  }

  // Chunked multi-row upsert (audit D6): ~500 rows/statement instead of one per day.
  for (const part of chunk(rows)) {
    await db
      .insert(portfolioSnapshots)
      .values(part)
      .onConflictDoUpdate({
        target: [portfolioSnapshots.portfolioId, portfolioSnapshots.date],
        set: {
          netWorth: sql`excluded.net_worth`,
          marketValue: sql`excluded.market_value`,
          effectiveFlow: sql`excluded.effective_flow`,
          currency: sql`excluded.currency`,
        },
      });
  }

  return rows.length;
}
