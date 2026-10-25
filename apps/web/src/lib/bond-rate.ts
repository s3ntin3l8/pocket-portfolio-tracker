import type { BondCouponRateSchedule } from "@portfolio/api-client";
import { couponRateForDate, type BondPosition } from "@portfolio/core";
import { fractionToPercent, percentToFraction } from "./tax-rate";

/**
 * The pure helpers behind the FLOATING-rate bond schedule editor (Indonesian retail
 * SBR/ST series: the coupon rate resets every three months off the BI reference rate
 * while the PAYMENTS stay monthly).
 *
 * Two independent axes, deliberately never merged: `couponSchedule` on the instrument is
 * the payment frequency; this is the RATE schedule.
 *
 * The schedule stores the ANNOUNCED EFFECTIVE rate per period plus the contractual floor
 * that applies to any period not (yet) announced. There is no BI rate provider in this
 * app, so a period the user cannot fill in yet simply falls back to the floor.
 *
 * Plain module (no "use client") so the server-rendered instrument detail page can use
 * `effectiveRateForDate` without pulling a client boundary into the server graph.
 */

/** One rate period as it is edited: percent-in, empty string for "not set". */
export interface RatePeriodDraft {
  /** First day of the period (inclusive), YYYY-MM-DD. */
  from: string;
  /** Last day of the period (exclusive), YYYY-MM-DD — empty = runs to maturity. */
  to: string;
  /** The announced annual rate for the period, in percent ("6.75"). */
  ratePercent: string;
}

export interface RateScheduleDraft {
  /** The contractual floor for the whole tenor, in percent ("6.75"). */
  floorRatePercent: string;
  periods: RatePeriodDraft[];
}

export const EMPTY_RATE_SCHEDULE_DRAFT: RateScheduleDraft = { floorRatePercent: "", periods: [] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why a draft can't be turned into a schedule yet — the editor shows the matching hint. */
export type RateScheduleIssue =
  "floorMissing" | "noPeriods" | "periodIncomplete" | "periodOverlaps" | null;

/**
 * The stored schedule, guarded.
 *
 * `instruments.coupon_rate_schedule` is untyped jsonb and the API's read path returns
 * it as-is, so a malformed row must not throw here: the instrument page would 500
 * instead of degrading to "no schedule". A schedule without a `periods` array is
 * treated as no schedule at all.
 */
function safeSchedule(
  schedule: BondCouponRateSchedule | null | undefined,
): BondCouponRateSchedule | null {
  if (!schedule || !Array.isArray(schedule.periods)) return null;
  return schedule;
}

/** The stored schedule → the editable draft. Rates become percent strings. */
export function rateScheduleToDraft(
  schedule: BondCouponRateSchedule | null | undefined,
): RateScheduleDraft {
  const safe = safeSchedule(schedule);
  if (!safe) return { ...EMPTY_RATE_SCHEDULE_DRAFT, periods: [] };
  return {
    floorRatePercent: fractionToPercent(safe.floorRate),
    periods: safe.periods.map((p) => ({
      from: p.from,
      to: p.to ?? "",
      ratePercent: fractionToPercent(p.rate),
    })),
  };
}

/**
 * What is wrong with the draft, if anything. Mirrors the API's own rules (a period must
 * be complete, periods must not overlap) so the form can say so BEFORE the request,
 * instead of bouncing a 400.
 *
 * The periods are checked in chronological order, so an overlap is caught no matter which
 * order the user typed them in — the ORDER itself is not an error: the payload sorts the
 * periods by start date on the way out.
 */
export function validateRateScheduleDraft(draft: RateScheduleDraft): RateScheduleIssue {
  if (percentToFraction(draft.floorRatePercent.trim()) == null) return "floorMissing";
  if (draft.periods.length === 0) return "noPeriods";

  const sorted = [...draft.periods].sort((a, b) => a.from.localeCompare(b.from));
  for (const p of sorted) {
    if (!ISO_DATE.test(p.from.trim())) return "periodIncomplete";
    if (p.to.trim() !== "" && !ISO_DATE.test(p.to.trim())) return "periodIncomplete";
    if (p.to.trim() !== "" && p.to.trim() <= p.from.trim()) return "periodIncomplete";
    if (percentToFraction(p.ratePercent.trim()) == null) return "periodIncomplete";
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.to.trim() === "" || cur.from.trim() < prev.to.trim()) return "periodOverlaps";
  }
  return null;
}

/**
 * The editable draft → the API payload, or undefined when the draft is not yet usable.
 *
 * An incomplete form must never send a half-filled schedule: the bond would silently
 * lose its rate projection. The periods are sorted by start date on the way out (the
 * API requires ascending order), so the user can type them in any order.
 */
export function rateScheduleDraftToApi(
  draft: RateScheduleDraft,
): BondCouponRateSchedule | undefined {
  if (validateRateScheduleDraft(draft) !== null) return undefined;
  const floorRate = percentToFraction(draft.floorRatePercent.trim());
  if (floorRate == null) return undefined;
  const periods = [...draft.periods]
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((p) => {
      const period: { from: string; to?: string; rate: string } = {
        from: p.from.trim(),
        rate: percentToFraction(p.ratePercent.trim()) as string,
      };
      const to = p.to.trim();
      if (to !== "") period.to = to;
      return period;
    });
  return { floorRate, periods };
}

/**
 * The core resolver only reads the two rate fields, so a schedule-only position is
 * enough here: the flat `couponRate` is empty, which means the resolver returns the
 * announced period's rate or the floor — never a flat rate this display doesn't have.
 */
const SCHEDULE_ONLY_POSITION: BondPosition = {
  instrumentId: "",
  symbol: "",
  quantity: "0",
  faceValue: "0",
  couponRate: "",
  couponSchedule: null,
  maturityDate: "",
  currency: "",
};

/**
 * The rate that applies on a given day, for the *display* of a floating bond's current
 * terms.
 *
 * This is the SAME resolution the projection uses — `couponRateForDate()` in
 * @portfolio/core, not a second copy of the precedence rule.
 */
export function effectiveRateForDate(
  schedule: BondCouponRateSchedule | null | undefined,
  dateKey: string,
): string | null {
  const safe = safeSchedule(schedule);
  if (!safe) return null;
  return couponRateForDate({ ...SCHEDULE_ONLY_POSITION, couponRateSchedule: safe }, dateKey);
}
