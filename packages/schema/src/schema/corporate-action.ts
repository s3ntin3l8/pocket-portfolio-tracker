import { z } from "zod";
import { decimalString } from "./primitives.js";

export const corporateActionTypeSchema = z.enum(["split", "bonus", "rights", "merger"]);
export type CorporateActionType = z.infer<typeof corporateActionTypeSchema>;

export const corporateActionInputSchema = z
  .object({
    instrumentId: z.guid(),
    type: corporateActionTypeSchema,
    ratio: decimalString,
    exDate: z.coerce.date(),
    terms: z.string().optional(),
    // Merger-specific (required when type = "merger")
    targetInstrumentId: z.guid().optional(),
    ratioTo: decimalString.optional(),
    taxableMarketValue: decimalString.optional(),
  })
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
