import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { dividendEvents, instruments, lossCarryforward } from "@portfolio/db";
import type {
  CoreTransaction,
  PortfolioSummary,
  IncomeEntry,
  TradeLog,
  IndonesianFinalTax,
  IdDisposalInput,
  IdDividendInput,
  IdYearInput,
} from "@portfolio/core";
import {
  cashFlow,
  projectCoupons,
  projectDividends,
  convert,
  toDateKey,
  indonesianFinalTax,
} from "@portfolio/core";
import { getFxRates, makeFxRateFn } from "../../services/fx.js";
import type { InstrumentMeta } from "../../services/valuation.js";

export async function lossCarryForwardFor(
  app: FastifyInstance,
  holderId: string,
  taxYear: number,
): Promise<{ stock?: string; general?: string }> {
  const rows = await app.db
    .select({ pot: lossCarryforward.pot, amount: lossCarryforward.amount })
    .from(lossCarryforward)
    .where(and(eq(lossCarryforward.holderId, holderId), eq(lossCarryforward.taxYear, taxYear)));
  const result: { stock?: string; general?: string } = {};
  for (const r of rows) {
    if (r.pot === "stock") result.stock = r.amount;
    else if (r.pot === "general") result.general = r.amount;
  }
  return result;
}

/**
 * Compute the gross rest-of-year (today → Dec 31) dividend + coupon income forecast for
 * one portfolio, in `display` currency.  Used by the tax endpoints to feed
 * `forecastIncomeRestOfYear` into `allowanceUsageYTD`.
 *
 * - Projected-from-history dividends are grossed up via each instrument's trailing-12-month
 *   withholding ratio (gross = net + tax, default ratio 1.0 when no withholding recorded).
 * - Announced dividend_events amounts and projected bond coupons are already gross.
 * - Returns "0" when `year` is not the current UTC calendar year.
 */
export async function restOfYearForecastGross(
  app: FastifyInstance,
  coreTxns: CoreTransaction[],
  summary: PortfolioSummary,
  display: string,
  year: number,
  now: Date = new Date(),
): Promise<string> {
  if (year !== now.getUTCFullYear()) return "0";

  const heldIds = summary.holdings.filter((h) => Number(h.quantity) > 0).map((h) => h.instrumentId);
  if (heldIds.length === 0) return "0";

  const heldQtyMap = new Map<string, string>(
    summary.holdings.filter((h) => Number(h.quantity) > 0).map((h) => [h.instrumentId, h.quantity]),
  );

  const qtyAt = (_instrumentId: string, _at: Date): string => heldQtyMap.get(_instrumentId) ?? "0";

  const pastDivEvents: IncomeEntry[] = coreTxns
    .filter((t) => t.type === "dividend" && t.instrumentId)
    .map((t) => ({
      instrumentId: t.instrumentId,
      symbol: null,
      name: null,
      assetClass: null,
      type: t.type,
      price: t.price,
      currency: t.currency,
      executedAt: t.executedAt,
    }));

  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const grossUpNet = new Map<string, number>();
  const grossUpTax = new Map<string, number>();
  for (const t of coreTxns) {
    if (t.type !== "dividend" || !t.instrumentId || t.executedAt < yearAgo) continue;
    const net = Number(cashFlow(t).toString());
    const tax = Number(t.tax ?? "0");
    if (net <= 0) continue;
    grossUpNet.set(t.instrumentId, (grossUpNet.get(t.instrumentId) ?? 0) + net);
    grossUpTax.set(t.instrumentId, (grossUpTax.get(t.instrumentId) ?? 0) + tax);
  }

  const projectedDivs = projectDividends(pastDivEvents, heldQtyMap, qtyAt, now);

  const todayStr = toDateKey(now);
  const yearEndStr = toDateKey(new Date(Date.UTC(now.getUTCFullYear(), 11, 31)));

  const announcedRows =
    heldIds.length > 0
      ? await app.db
          .select()
          .from(dividendEvents)
          .where(inArray(dividendEvents.instrumentId, heldIds))
      : [];

  const futureByInstrument = new Map<
    string,
    { exDate: string; amount: string; currency: string }[]
  >();
  for (const row of announcedRows) {
    const qty = heldQtyMap.get(row.instrumentId);
    if (!qty) continue;
    const totalAmount = String(Number(row.amountPerShare) * Number(qty));
    const list = futureByInstrument.get(row.instrumentId) ?? [];
    list.push({ exDate: row.exDate, amount: totalAmount, currency: row.currency });
    futureByInstrument.set(row.instrumentId, list);
  }

  const instrumentsWithAnnounced = new Set(
    [...futureByInstrument.entries()]
      .filter(([_, rows]) => rows.some((r) => r.exDate > todayStr && r.exDate <= yearEndStr))
      .map(([id]) => id),
  );
  const blendedProjected = projectedDivs.filter(
    (d) => d.instrumentId && !instrumentsWithAnnounced.has(d.instrumentId!),
  );
  const announcedRestOfYear = [...futureByInstrument.values()]
    .flat()
    .filter((d) => d.exDate > todayStr && d.exDate <= yearEndStr);

  const bondRows =
    heldIds.length > 0
      ? await app.db
          .select()
          .from(instruments)
          .where(and(inArray(instruments.id, heldIds), eq(instruments.assetClass, "bond")))
      : [];
  const qtyById = new Map(summary.holdings.map((h) => [h.instrumentId, h.quantity]));
  const bondPositions = bondRows
    .filter((b) => b.faceValue && b.couponRate && b.maturityDate)
    .map((b) => ({
      instrumentId: b.id,
      symbol: b.symbol,
      name: b.name,
      quantity: qtyById.get(b.id) ?? "0",
      faceValue: b.faceValue as string,
      couponRate: b.couponRate as string,
      couponSchedule: b.couponSchedule,
      maturityDate: b.maturityDate as string,
      currency: b.currency,
    }));
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  const restOfYearCoupons = projectCoupons(bondPositions, yearEnd, now).filter(
    (c) => c.date > todayStr,
  );

  const allCcys = new Set<string>([
    ...blendedProjected.map((d) => d.currency),
    ...announcedRestOfYear.map((d) => d.currency),
    ...restOfYearCoupons.map((c) => c.currency),
  ]);
  if (allCcys.size === 0) return "0";

  const rates = await getFxRates(app.db, [...allCcys], display);
  const fx = makeFxRateFn(rates, display);

  let totalGross = 0;

  for (const d of blendedProjected) {
    const net = Number(convert(d.amount, d.currency, display, fx));
    const instrumentId = d.instrumentId!;
    const netSum = grossUpNet.get(instrumentId) ?? 0;
    const taxSum = grossUpTax.get(instrumentId) ?? 0;
    const ratio = netSum > 0 ? (netSum + taxSum) / netSum : 1.0;
    totalGross += net * ratio;
  }

  for (const d of announcedRestOfYear) {
    totalGross += Number(convert(d.amount, d.currency, display, fx));
  }

  for (const c of restOfYearCoupons) {
    totalGross += Number(convert(c.amount, c.currency, display, fx));
  }

  return totalGross > 0 ? totalGross.toFixed(2) : "0";
}

export function buildTfRates(
  trades: { instrumentId: string }[],
  metaById: Map<string, InstrumentMeta>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const t of trades) {
    const meta = metaById.get(t.instrumentId);
    if (!meta) continue;
    if (meta.partialExemptionRate !== null) {
      result[t.instrumentId] = meta.partialExemptionRate;
    } else if (meta.assetClass === "etf") {
      result[t.instrumentId] = "0.30";
    } else if (meta.assetClass === "mutual_fund") {
      result[t.instrumentId] = "0.15";
    }
  }
  return result;
}

/**
 * Build the Indonesian final-tax payload from a (single) portfolio's trade log + raw core
 * transactions. Mirrors the web tier's per-holder assembly in `loadTaxYearDetail` so the
 * API and the (replaced) client side agree to the decimal — single source of truth.
 *
 * - Disposals for `year` are grouped by (instrumentId, sellDate) so each disposal row is
 *   one economic sale day, with proceeds / quantity / avg-buy / sell-price.
 * - Dividends for `year` are grouped by (instrumentId, currency) with gross = net + tax
 *   (`cashFlow` computes net = qty × price − fees for income rows).
 * - `byYear` rolls proceeds and dividends across every year the trade log spans so prior
 *   tax years still get a real Est. tax figure under ID.
 */
export function computeIndonesianFinalTaxFromTradeLog(input: {
  tradeLog: TradeLog;
  coreTxns: CoreTransaction[];
  year: number;
  metaById: Map<string, InstrumentMeta>;
  /** User's display currency. Dividends are converted from their native currency to
   *  this before being summed — otherwise a EUR depot + IDR user would sum EUR figures
   *  and label them IDR (the response's `currency` field). */
  displayCurrency: string;
  /** Native-currency → displayCurrency conversion rates, keyed by the native currency.
   *  Obtained from `getFxRates(app.db, ccys, display)` in the calling route. */
  fxRates: Map<string, number>;
}): IndonesianFinalTax {
  const { tradeLog, coreTxns, year, metaById, displayCurrency, fxRates } = input;
  const ZERO = "0";

  // Native-currency → display-currency. Returns the same amount when source currency
  // is already the display currency (or no rate is registered — accepts the imprecision
  // on that one bucket rather than throwing on the entire report).
  const fxTo = (amount: Decimal, fromCurrency: string): Decimal => {
    if (fromCurrency === displayCurrency) return amount;
    const rate = fxRates.get(fromCurrency);
    if (rate === undefined) return amount;
    return amount.mul(rate);
  };

  // Disposals for the selected year, grouped per (instrumentId, sellDate).
  type DisposalGroup = {
    instrumentId: string;
    symbol: string;
    when: string;
    proceeds: Decimal;
    quantity: Decimal;
    cost: Decimal;
  };
  const disposalGroups = new Map<string, DisposalGroup>();
  for (const t of tradeLog.trades) {
    for (const l of t.legs) {
      if (l.taxYear !== year) continue;
      const key = `${t.instrumentId}:${l.sellDate}`;
      const qty = new Decimal(l.quantity);
      const proceeds = new Decimal(l.proceeds);
      const cost = new Decimal(l.cost);
      const existing = disposalGroups.get(key);
      const symbol = metaById.get(t.instrumentId)?.symbol ?? t.instrumentId.slice(0, 8);
      if (existing) {
        existing.proceeds = existing.proceeds.add(proceeds);
        existing.quantity = existing.quantity.add(qty);
        existing.cost = existing.cost.add(cost);
      } else {
        disposalGroups.set(key, {
          instrumentId: t.instrumentId,
          symbol,
          when: l.sellDate,
          proceeds,
          quantity: qty,
          cost,
        });
      }
    }
  }
  const disposals: IdDisposalInput[] = [...disposalGroups.values()].map((g) => ({
    symbol: g.symbol,
    when: g.when,
    instrumentId: g.instrumentId,
    proceeds: g.proceeds.toFixed(2),
    quantity: g.quantity.gt(0) ? g.quantity.toString() : ZERO,
    avgBuyPrice: g.quantity.gt(0) ? g.cost.div(g.quantity).toFixed(2) : ZERO,
    sellPrice: g.quantity.gt(0) ? g.proceeds.div(g.quantity).toFixed(2) : ZERO,
  }));

  // Dividends / coupons / interest for the selected year, grouped per (instrumentId, currency).
  type DivBucket = { symbol: string; currency: string; gross: Decimal; tax: Decimal };
  const divBuckets = new Map<string, DivBucket>();
  for (const t of coreTxns) {
    if (t.type !== "dividend" && t.type !== "coupon" && t.type !== "interest") {
      continue;
    }
    if (t.executedAt.getUTCFullYear() !== year) continue;
    const instrumentId = t.instrumentId ?? null;
    const symbol = instrumentId ?? t.type;
    const key = `${instrumentId ?? t.type}:${t.currency}`;
    // cashFlow computes net = (qty>0 ? qty*price : price) − fees for income rows; gross
    // is then net + broker-recorded withholding (so the ID 10% sits on the gross figure,
    // not the net received). The ID tax function deliberately re-derives its own 10% on
    // this gross and ignores the broker's withholding tag.
    // Convert each income row's net + tax to display currency so the sum doesn't mix
    // native-currency figures under the response's display label (hermes re-review warning).
    const net = fxTo(
      new Decimal(cashFlow({ ...t, type: t.type as CoreTransaction["type"] }).toString()),
      t.currency,
    );
    const tax = fxTo(new Decimal((t as { tax?: string | null }).tax ?? "0"), t.currency);
    const gross = net.add(tax);
    const existing = divBuckets.get(key);
    if (existing) {
      existing.gross = existing.gross.add(gross);
      existing.tax = existing.tax.add(tax);
    } else {
      divBuckets.set(key, { symbol, currency: t.currency, gross, tax });
    }
  }
  const dividends: IdDividendInput[] = [...divBuckets.values()].map((b) => ({
    symbol: b.symbol,
    currency: b.currency,
    gross: b.gross.toFixed(2),
  }));

  // Per-year proceeds from the trade log legs (across ALL years, for the byYear table).
  // TradeLog itself is already in display currency (built via `mergeTradeLogs(logs, display)`),
  // so byYear rows stay in display currency end-to-end — no FX pass needed here.
  const proceedsByYearMap = new Map<number, Decimal>();
  for (const t of tradeLog.trades) {
    for (const l of t.legs) {
      const prev = proceedsByYearMap.get(l.taxYear) ?? new Decimal(0);
      proceedsByYearMap.set(l.taxYear, prev.add(l.proceeds));
    }
  }
  const allYears = new Set<number>([
    ...proceedsByYearMap.keys(),
    ...tradeLog.dividendsByYear.map((d) => d.year),
    ...tradeLog.realizedByYear.map((r) => r.year),
  ]);
  const byYear: IdYearInput[] = [...allYears].map((y) => {
    const divEntry = tradeLog.dividendsByYear.find((d) => d.year === y);
    // tradeLog.dividendsByYear is in display currency (same as the per-holder divBuckets
    // conversion above). Add amount + tax to recover gross.
    const dividendGross = divEntry
      ? new Decimal(divEntry.amount).add(divEntry.tax ?? "0")
      : new Decimal(0);
    const realized = tradeLog.realizedByYear.find((r) => r.year === y)?.amount ?? "0";
    return {
      year: y,
      proceeds: (proceedsByYearMap.get(y) ?? new Decimal(0)).toFixed(2),
      dividendGross: dividendGross.toFixed(2),
      realized,
    };
  });

  return indonesianFinalTax({ disposals, dividends, byYear });
}
