import { Decimal } from "decimal.js";
import { toDateKey } from "./date-utils.js";

export interface BondPosition {
  instrumentId: string;
  symbol: string;
  name?: string | null;
  quantity: string;
  faceValue: string;
  couponRate: string;
  couponSchedule: string | null;
  maturityDate: string;
  currency: string;
}

export interface ProjectedCoupon {
  instrumentId: string;
  symbol: string;
  name?: string | null;
  date: string;
  amount: string;
  currency: string;
}

const PERIODS_PER_YEAR: Record<string, number> = {
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
};

export function projectCoupons(
  positions: BondPosition[],
  horizon: number | Date = 12,
  now: Date = new Date(),
): ProjectedCoupon[] {
  let horizonEnd: Date;
  if (horizon instanceof Date) {
    horizonEnd = horizon;
  } else {
    horizonEnd = new Date(now);
    horizonEnd.setUTCMonth(horizonEnd.getUTCMonth() + horizon);
  }

  const out: ProjectedCoupon[] = [];
  for (const p of positions) {
    const periods = PERIODS_PER_YEAR[p.couponSchedule ?? "semiannual"] ?? 2;
    const intervalMonths = 12 / periods;
    if (intervalMonths <= 0) continue;

    const maturity = new Date(`${p.maturityDate}T00:00:00.000Z`);
    if (Number.isNaN(maturity.getTime())) continue;
    if (new Decimal(p.quantity).lte(0)) continue;

    const amount = new Decimal(p.faceValue)
      .mul(p.quantity)
      .mul(p.couponRate)
      .div(periods)
      .toString();

    const d = new Date(maturity);
    while (d > now) {
      if (d <= horizonEnd) {
        out.push({
          instrumentId: p.instrumentId,
          symbol: p.symbol,
          name: p.name,
          date: toDateKey(d),
          amount,
          currency: p.currency,
        });
      }
      d.setUTCMonth(d.getUTCMonth() - intervalMonths);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
