import { z } from "zod";
import { assetClassSchema, unitSchema } from "./enums.js";
import { currencyCode } from "./primitives.js";

export const instrumentInputSchema = z.object({
  isin: z.string().optional(),
  wkn: z.string().optional(),
  symbol: z.string().min(1),
  market: z.string().min(1),
  assetClass: assetClassSchema,
  unit: unitSchema.default("shares"),
  currency: currencyCode,
  name: z.string().min(1),
});
export type InstrumentInput = z.infer<typeof instrumentInputSchema>;
