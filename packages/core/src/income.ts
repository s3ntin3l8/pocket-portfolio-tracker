import { Decimal } from "decimal.js";
import { convert, type FxRateFn } from "./networth.js";
import { toMonthKey } from "./date-utils.js";

/** Trailing dividend/coupon income per instrument since `since`, in display currency. */
export function trailingIncomeByInstrument(
  txns: {
    instrumentId: string | null;
    type: string;
    price: string;
    currency: string;
    executedAt: Date;
  }[],
  since: Date,
  displayCurrency: string,
  fx: FxRateFn = () => "1",
): Record<string, string> {
  const acc: Record<string, Decimal> = {};
  for (const t of txns) {
    if ((t.type === "dividend" || t.type === "coupon") && t.instrumentId && t.executedAt >= since) {
      const amt = convert(t.price, t.currency, displayCurrency, fx);
      acc[t.instrumentId] = (acc[t.instrumentId] ?? new Decimal(0)).add(amt);
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.toString()]));
}

/** Trailing yield = trailing income ÷ market value, or null when value is zero. */
export function trailingYield(trailingIncome: string, marketValue: string): string | null {
  const mv = new Decimal(marketValue);
  if (mv.isZero()) return null;
  return new Decimal(trailingIncome).div(mv).toString();
}

/** One dividend/coupon cash event, enriched with the instrument's metadata. */
export interface IncomeEntry {
  instrumentId: string | null;
  symbol?: string | null;
  name?: string | null;
  displayName?: string | null;
  assetClass?: string | null;
  type: string;
  price: string;
  currency: string;
  executedAt: Date;
}

export interface YearIncome {
  year: string;
  total: string;
  paymentCount: number;
}
export interface MonthIncome {
  month: string;
  total: string;
}
export interface InstrumentIncome {
  instrumentId: string | null;
  symbol: string | null;
  name: string | null;
  displayName: string | null;
  total: string;
  pct: number;
}
export interface AssetClassIncome {
  assetClass: string;
  total: string;
  pct: number;
}
export interface CurrencyIncome {
  currency: string;
  totalNative: string;
  totalNormalized: string;
}

export interface IncomeStats {
  byYear: YearIncome[];
  monthly: MonthIncome[];
  ttm: string;
  thisYear: string;
  lastYear: string;
  deltaAbs: string;
  deltaPct: number | null;
  forecastNextYear: string;
  forecastRestOfYear: string;
  forecastFullYear: string;
  lifetimeTotal: string;
  byInstrument: InstrumentIncome[];
  byAssetClass: AssetClassIncome[];
  byCurrency: CurrencyIncome[];
  paymentCount: number;
  averagePerPayment: string;
}

export interface AggregateIncomeInput {
  events: IncomeEntry[];
  displayCurrency: string;
  fx?: FxRateFn;
  now?: Date;
  forecastCoupons?: { amount: string; currency: string }[];
  restOfYearCoupons?: { amount: string; currency: string }[];
  projectedDividends?: { amount: string; currency: string }[];
  projectedDividendsNextYear?: { amount: string; currency: string }[];
  heldQty?: Map<string, string>;
  qtyAt?: (instrumentId: string, at: Date) => string;
}

const ZERO = () => new Decimal(0);

export function aggregateIncome(input: AggregateIncomeInput): IncomeStats {
  const { events, displayCurrency } = input;
  const fx: FxRateFn = input.fx ?? (() => "1");
  const now = input.now ?? new Date();

  const ttmStart = new Date(now);
  ttmStart.setUTCFullYear(ttmStart.getUTCFullYear() - 1);
  const currentYear = now.getUTCFullYear();

  const byYear = new Map<string, { total: Decimal; count: number }>();
  const byMonth = new Map<string, Decimal>();
  const byInstrument = new Map<
    string,
    { symbol: string | null; name: string | null; displayName: string | null; total: Decimal }
  >();
  const byClass = new Map<string, Decimal>();
  const byCurrency = new Map<string, { native: Decimal; normalized: Decimal }>();

  let lifetime = ZERO();
  let ttm = ZERO();
  let ttmDividends = ZERO();
  let thisYear = ZERO();
  let lastYear = ZERO();

  for (const e of events) {
    const amount = new Decimal(convert(e.price, e.currency, displayCurrency, fx));
    const year = String(e.executedAt.getUTCFullYear());
    const month = toMonthKey(e.executedAt);

    lifetime = lifetime.add(amount);

    const y = byYear.get(year) ?? { total: ZERO(), count: 0 };
    byYear.set(year, { total: y.total.add(amount), count: y.count + 1 });

    byMonth.set(month, (byMonth.get(month) ?? ZERO()).add(amount));

    const instKey = e.instrumentId ?? "—";
    const inst = byInstrument.get(instKey) ?? {
      symbol: e.symbol ?? null,
      name: e.name ?? null,
      displayName: e.displayName ?? null,
      total: ZERO(),
    };
    byInstrument.set(instKey, { ...inst, total: inst.total.add(amount) });

    const cls = e.assetClass ?? "equity";
    byClass.set(cls, (byClass.get(cls) ?? ZERO()).add(amount));

    const cur = byCurrency.get(e.currency) ?? { native: ZERO(), normalized: ZERO() };
    byCurrency.set(e.currency, {
      native: cur.native.add(e.price),
      normalized: cur.normalized.add(amount),
    });

    if (e.executedAt >= ttmStart) {
      ttm = ttm.add(amount);
      if (e.type === "dividend") {
        let scaledAmount = amount;
        if (e.instrumentId && input.heldQty) {
          const currentQtyStr = input.heldQty.get(e.instrumentId);
          if (currentQtyStr) {
            const currentQty = new Decimal(currentQtyStr);
            const histQtyStr = input.qtyAt ? input.qtyAt(e.instrumentId, e.executedAt) : "0";
            const histQty = new Decimal(histQtyStr);
            if (histQty.gt(0)) {
              scaledAmount = amount.mul(currentQty).div(histQty);
            }
          } else {
            scaledAmount = ZERO();
          }
        }
        ttmDividends = ttmDividends.add(scaledAmount);
      }
    }
    if (e.executedAt.getUTCFullYear() === currentYear) thisYear = thisYear.add(amount);
    else if (e.executedAt.getUTCFullYear() === currentYear - 1) lastYear = lastYear.add(amount);
  }

  const pct = (v: Decimal) => (lifetime.isZero() ? 0 : v.div(lifetime).toNumber());
  const deltaAbs = thisYear.sub(lastYear);
  const couponForecast = (input.forecastCoupons ?? []).reduce(
    (s, c) => s.add(convert(c.amount, c.currency, displayCurrency, fx)),
    ZERO(),
  );
  const nextYearDividendForecast =
    input.projectedDividendsNextYear !== undefined
      ? input.projectedDividendsNextYear.reduce(
          (s, d) => s.add(convert(d.amount, d.currency, displayCurrency, fx)),
          ZERO(),
        )
      : ttmDividends;
  const forecast = nextYearDividendForecast.add(couponForecast);

  const restOfYearCouponSum = (input.restOfYearCoupons ?? []).reduce(
    (s, c) => s.add(convert(c.amount, c.currency, displayCurrency, fx)),
    ZERO(),
  );
  const projectedDividendSum = (input.projectedDividends ?? []).reduce(
    (s, d) => s.add(convert(d.amount, d.currency, displayCurrency, fx)),
    ZERO(),
  );
  const forecastRestOfYear = restOfYearCouponSum.add(projectedDividendSum);
  const forecastFullYear = thisYear.add(forecastRestOfYear);

  const count = events.length;

  return {
    byYear: [...byYear.entries()]
      .map(([year, v]) => ({ year, total: v.total.toString(), paymentCount: v.count }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    monthly: [...byMonth.entries()]
      .map(([month, total]) => ({ month, total: total.toString() }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    ttm: ttm.toString(),
    thisYear: thisYear.toString(),
    lastYear: lastYear.toString(),
    deltaAbs: deltaAbs.toString(),
    deltaPct: lastYear.isZero() ? null : deltaAbs.div(lastYear).toNumber(),
    forecastNextYear: forecast.toString(),
    forecastRestOfYear: forecastRestOfYear.toString(),
    forecastFullYear: forecastFullYear.toString(),
    lifetimeTotal: lifetime.toString(),
    byInstrument: [...byInstrument.entries()]
      .map(([instrumentId, v]) => ({
        instrumentId: instrumentId === "—" ? null : instrumentId,
        symbol: v.symbol,
        name: v.name,
        displayName: v.displayName,
        total: v.total.toString(),
        pct: pct(v.total),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    byAssetClass: [...byClass.entries()]
      .map(([assetClass, total]) => ({
        assetClass,
        total: total.toString(),
        pct: pct(total),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    byCurrency: [...byCurrency.entries()]
      .map(([currency, v]) => ({
        currency,
        totalNative: v.native.toString(),
        totalNormalized: v.normalized.toString(),
      }))
      .sort((a, b) => Number(b.totalNormalized) - Number(a.totalNormalized)),
    paymentCount: count,
    averagePerPayment: count > 0 ? lifetime.div(count).toString() : "0",
  };
}
