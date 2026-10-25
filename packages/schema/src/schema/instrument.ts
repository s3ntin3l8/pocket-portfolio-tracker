import { Decimal } from "decimal.js";
import { z } from "zod";
import { assetClassSchema, couponScheduleSchema, unitSchema } from "./enums.js";
import { currencyCode, decimalString } from "./primitives.js";

/** `YYYY-MM-DD`. Compared lexicographically, which equals chronological order. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One announced coupon-rate period of a FLOATING-rate bond. The period is half-open —
 * `[from, to)`: `from` is inclusive, `to` exclusive. An omitted `to` runs to maturity.
 */
export const bondRatePeriodSchema = z.object({
  from: z.string().regex(ISO_DATE, "must be YYYY-MM-DD"),
  to: z.string().regex(ISO_DATE, "must be YYYY-MM-DD").optional(),
  /** ANNUAL coupon rate for the period, as a FRACTION ("0.0685"), never a percent. */
  rate: decimalString,
});
export type BondRatePeriod = z.infer<typeof bondRatePeriodSchema>;

/**
 * A floating-rate bond's coupon-rate schedule.
 *
 * Indonesian retail floating-rate bonds (SBR/ST series) reset their coupon rate every
 * three months off the BI 7-Day Reverse Repo Rate plus a fixed spread, floored at the
 * first-period rate, and PAY monthly. Payment frequency and rate-reset frequency are
 * therefore two independent axes: `instruments.couponSchedule` carries the PAYMENT
 * frequency, this carries the RATE schedule.
 *
 * The stored rate is the ANNOUNCED EFFECTIVE rate (it already bakes in
 * `max(reference + spread, floor)`); there is no reference-rate provider in this repo, so
 * a period whose rate has not been announced yet falls back to `floorRate` — the
 * contractual minimum for the whole tenor.
 *
 * `from`/`to` are ISO dates; `rate`/`floorRate` are annual fractions.
 */
export const bondCouponRateScheduleSchema = z
  .object({
    /** Contractual floor for the whole tenor (fraction). Applies to any period whose
     *  announced rate is not yet known. */
    floorRate: decimalString,
    /** The announced rate periods, half-open `[from, to)`. At least one. */
    periods: z.array(bondRatePeriodSchema).min(1),
  })
  .superRefine((val, ctx) => {
    const floor = new Decimal(val.floorRate);
    if (floor.isNegative() || floor.gt(1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be a rate between 0 and 1 (a fraction, not a percent)",
        path: ["floorRate"],
      });
    }

    let prev: BondRatePeriod | null = null;
    for (const [i, p] of val.periods.entries()) {
      const rate = new Decimal(p.rate);
      if (rate.isNegative() || rate.gt(1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "must be a rate between 0 and 1 (a fraction, not a percent)",
          path: ["periods", i, "rate"],
        });
      }
      if (!floor.isNegative() && !floor.gt(1) && rate.lt(floor)) {
        // The announced rate is max(reference + spread, floor) — it can never sit below
        // the floor, so a rate under it means the input is inconsistent.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "must not be below the floor rate",
          path: ["periods", i, "rate"],
        });
      }
      if (p.to != null && p.to <= p.from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "must be after 'from'",
          path: ["periods", i, "to"],
        });
      }
      if (prev) {
        if (p.from < prev.from) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "rate periods must be listed in ascending order",
            path: ["periods", i, "from"],
          });
        } else if (prev.to == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "overlaps the previous period, which has no end date",
            path: ["periods", i, "from"],
          });
        } else if (p.from < prev.to) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "overlaps the previous period",
            path: ["periods", i, "from"],
          });
        }
      }
      prev = p;
    }
  });
export type BondCouponRateSchedule = z.infer<typeof bondCouponRateScheduleSchema>;

export const instrumentInputSchema = z
  .object({
    isin: z.string().optional(),
    wkn: z.string().optional(),
    symbol: z.string().min(1),
    market: z.string().min(1),
    assetClass: assetClassSchema,
    unit: unitSchema.default("shares"),
    currency: currencyCode,
    name: z.string().min(1),
    // Bond terms — only meaningful (and only accepted) for assetClass "bond". `faceValue`
    // is the PER-UNIT nominal (e.g. "1000000" for an Rp 1,000,000 SR/ORI unit, not the
    // total position size); `couponRate` is a FRACTION ("0.0635"), not a percent.
    faceValue: decimalString.optional(),
    couponRate: decimalString.optional(),
    couponSchedule: couponScheduleSchema.optional(),
    // Floating-rate bonds (SBR/ST) carry a per-period RATE schedule instead of a single
    // constant rate. When present it OVERRIDES `couponRate` for the dates its periods
    // cover; `couponRate` stays the fallback for anything the schedule doesn't cover.
    couponRateSchedule: bondCouponRateScheduleSchema.optional(),
    maturityDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
      .optional(),
  })
  .superRefine((val, ctx) => {
    const hasBondField =
      val.faceValue !== undefined ||
      val.couponRate !== undefined ||
      val.couponSchedule !== undefined ||
      val.couponRateSchedule !== undefined ||
      val.maturityDate !== undefined;
    if (hasBondField && val.assetClass !== "bond") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Bond terms (faceValue/couponRate/couponSchedule/couponRateSchedule/maturityDate) require assetClass "bond"',
        path: ["assetClass"],
      });
    }
  });
export type InstrumentInput = z.infer<typeof instrumentInputSchema>;
