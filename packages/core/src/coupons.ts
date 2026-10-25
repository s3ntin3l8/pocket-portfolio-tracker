import { Decimal } from "decimal.js";
import { toDateKey } from "./date-utils.js";

/**
 * One announced coupon-rate period of a floating-rate bond — `[from, to)`, `from`
 * inclusive, `to` exclusive, `to` omitted = runs to maturity.
 *
 * Mirrors `bondRatePeriodSchema` in @portfolio/schema — keep the two in step.
 */
export interface BondRatePeriod {
  from: string;
  to?: string;
  rate: string;
}

/**
 * A floating-rate bond's coupon-rate schedule: the ANNOUNCED effective rate per period
 * plus the contractual floor that applies to any period not (yet) announced.
 *
 * Mirrors `bondCouponRateScheduleSchema` in @portfolio/schema — keep the two in step.
 */
export interface BondCouponRateSchedule {
  floorRate: string;
  periods: BondRatePeriod[];
}

export interface BondPosition {
  instrumentId: string;
  symbol: string;
  name?: string | null;
  quantity: string;
  faceValue: string;
  couponRate: string;
  couponSchedule: string | null;
  /**
   * Optional floating-rate schedule. When present it OVERRIDES `couponRate` for the
   * dates its periods cover; `couponRate` remains the fallback for anything the
   * schedule doesn't cover. `couponSchedule` is the PAYMENT frequency and is a
   * separate axis — an SBR/ST bond pays monthly while its rate resets quarterly.
   */
  couponRateSchedule?: BondCouponRateSchedule | null;
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

export const PERIODS_PER_YEAR: Record<string, number> = {
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
};

/**
 * Normalize a free-text `couponSchedule` value into one of `PERIODS_PER_YEAR`'s keys.
 * The DB column is `text`, not an enum, so historical/typo'd values ("semi-annual",
 * "Semi Annual") must resolve rather than silently mis-fall-through to the `?? 2`
 * default at a different rate than intended. Unknown/empty input keeps that same
 * semiannual default so existing behavior for unset schedules is unchanged.
 */
export function normalizeCouponSchedule(raw: string | null | undefined): string {
  const key = (raw ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (key in PERIODS_PER_YEAR) return key;
  if (key === "biannual") return "semiannual";
  return "semiannual";
}

/**
 * The ANNUAL coupon rate that applies on `dateKey` (YYYY-MM-DD).
 *
 * Precedence: the announced rate of the period containing the date → the schedule's
 * floor rate → the position's flat `couponRate`.
 *
 * Dates are compared lexicographically, which equals chronological order for zero-padded
 * ISO dates — no `Date` parsing, so no timezone can shift a period boundary.
 *
 * Returns null only when the position carries neither a usable schedule nor a rate —
 * such a bond is not projected at all (never a zero-amount coupon).
 */
export function couponRateForDate(position: BondPosition, dateKey: string): string | null {
  const schedule = position.couponRateSchedule;
  if (schedule) {
    for (const period of schedule.periods) {
      if (period.from <= dateKey && (period.to == null || dateKey < period.to)) {
        return period.rate;
      }
    }
    if (schedule.floorRate) return schedule.floorRate;
  }
  return position.couponRate ? position.couponRate : null;
}

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
    const periods = PERIODS_PER_YEAR[normalizeCouponSchedule(p.couponSchedule)];
    const intervalMonths = 12 / periods;
    if (intervalMonths <= 0) continue;

    const maturity = new Date(`${p.maturityDate}T00:00:00.000Z`);
    if (Number.isNaN(maturity.getTime())) continue;
    if (new Decimal(p.quantity).lte(0)) continue;
    // A position with neither a rate nor a schedule can never produce a coupon — it is
    // skipped entirely rather than projected as a zero-amount coupon.
    if (!p.couponRate && !p.couponRateSchedule) continue;

    const d = new Date(maturity);
    // Walk back through the coupon ladder stopping at today's UTC start-of-day (not the
    // current instant). Otherwise `d` (a midnight-anchored YYYY-MM-DD coupon) compared
    // to `now` (a precise instant anywhere later in the same day) is strictly less, so
    // any coupon landing today would be silently skipped — the schedule says "06/15",
    // `now` is 06/15 18:00, `d` is 06/15 00:00, `d > now` is false, loop exits,
    // today's coupon is dropped. Coercing `now` to start-of-day makes the day-precision
    // coupon rows fall on the right side of the comparison.
    const nowStartOfDayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    while (d >= nowStartOfDayUtc) {
      if (d <= horizonEnd) {
        // The rate is resolved PER COUPON DATE: a floating-rate bond (SBR/ST) resets its
        // rate every few months, so one flat rate for the whole tenor would mis-state
        // every period that isn't the first. For a fixed-rate bond (no schedule) this
        // returns `couponRate` unchanged and the amount is identical to what it has
        // always been.
        const rate = couponRateForDate(p, toDateKey(d));
        if (rate != null) {
          const amount = new Decimal(p.faceValue).mul(p.quantity).mul(rate).div(periods).toString();
          out.push({
            instrumentId: p.instrumentId,
            symbol: p.symbol,
            name: p.name,
            date: toDateKey(d),
            amount,
            currency: p.currency,
          });
        }
      }
      d.setUTCMonth(d.getUTCMonth() - intervalMonths);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
