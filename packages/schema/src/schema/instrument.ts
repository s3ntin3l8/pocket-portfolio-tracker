import { z } from "zod";
import { assetClassSchema, couponScheduleSchema, unitSchema } from "./enums.js";
import { currencyCode, decimalString } from "./primitives.js";

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
      val.maturityDate !== undefined;
    if (hasBondField && val.assetClass !== "bond") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Bond terms (faceValue/couponRate/couponSchedule/maturityDate) require assetClass "bond"',
        path: ["assetClass"],
      });
    }
  });
export type InstrumentInput = z.infer<typeof instrumentInputSchema>;
