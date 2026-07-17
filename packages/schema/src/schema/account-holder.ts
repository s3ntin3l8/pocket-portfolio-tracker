import { z } from "zod";
import { decimalString } from "./primitives.js";

const accountHolderFields = {
  name: z.string().trim().min(1),
  type: z.enum(["self", "child", "other"]),
  taxAllowanceAnnual: decimalString.nullable(),
  capitalGainsTaxRate: decimalString.nullable(),
  churchTax: z.boolean().nullable(),
  taxResidence: z.string().trim().length(2).nullable(),
};

export const accountHolderInputSchema = z.object({
  name: accountHolderFields.name,
  type: accountHolderFields.type.default("other"),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  taxAllowanceAnnual: accountHolderFields.taxAllowanceAnnual.optional(),
  capitalGainsTaxRate: accountHolderFields.capitalGainsTaxRate.optional(),
  churchTax: accountHolderFields.churchTax.optional(),
  taxResidence: accountHolderFields.taxResidence.optional(),
});
export type AccountHolderInput = z.infer<typeof accountHolderInputSchema>;

export const accountHolderPatchSchema = z
  .object({
    ...accountHolderFields,
    birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
  })
  .partial();
export type AccountHolderPatch = z.infer<typeof accountHolderPatchSchema>;
