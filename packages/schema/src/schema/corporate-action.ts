import { z } from "zod";
import { decimalString } from "./primitives.js";

export const corporateActionTypeSchema = z.enum(["split", "bonus", "rights", "merger"]);
export type CorporateActionType = z.infer<typeof corporateActionTypeSchema>;

// Base object schema — no refinements, so it (or its `.partial()`) can be reused
// for PATCH-style operations. POST uses `corporateActionInputSchema` below, which
// layers the merger-type refinements on top.
export const corporateActionBaseSchema = z.object({
  instrumentId: z.guid(),
  type: corporateActionTypeSchema,
  ratio: decimalString,
  exDate: z.coerce.date(),
  terms: z.string().optional(),
  // Merger-specific (required when type = "merger")
  targetInstrumentId: z.guid().optional(),
  ratioTo: decimalString.optional(),
  taxableMarketValue: decimalString.optional(),
});

export const corporateActionInputSchema = corporateActionBaseSchema
  .refine(
    (v) => v.type !== "merger" || (v.targetInstrumentId !== undefined && v.ratioTo !== undefined),
    {
      message: "targetInstrumentId and ratioTo are required for merger type",
      path: ["targetInstrumentId"],
    },
  )
  .refine((v) => v.type === "merger" || v.targetInstrumentId === undefined, {
    message: "targetInstrumentId is only valid for merger type",
    path: ["targetInstrumentId"],
  });
export type CorporateActionInput = z.infer<typeof corporateActionInputSchema>;
