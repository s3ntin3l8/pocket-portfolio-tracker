import { z } from "zod";
import { decimalString } from "./primitives.js";

export const allocationDimensionSchema = z.enum([
  "asset_class",
  "currency",
  "region",
  "sector",
  "instrument",
]);
export type AllocationDimension = z.infer<typeof allocationDimensionSchema>;

export const allocationTargetEntrySchema = z.object({
  key: z.string().min(1),
  targetPct: z.number().min(0).max(100),
});

export const allocationTargetSetSchema = z
  .object({
    dimension: allocationDimensionSchema,
    portfolioId: z.guid().nullable().optional(),
    targets: z.array(allocationTargetEntrySchema).min(1),
  })
  .refine(
    (d) => {
      const sum = d.targets.reduce((acc, t) => acc + t.targetPct, 0);
      return Math.abs(sum - 100) <= 0.5;
    },
    { message: "Target percentages must sum to 100 (±0.5)" },
  );
export type AllocationTargetSet = z.infer<typeof allocationTargetSetSchema>;

export const lossCarryforwardEntrySchema = z.object({
  pot: z.enum(["stock", "general"]),
  amount: decimalString,
});
export type LossCarryforwardEntry = z.infer<typeof lossCarryforwardEntrySchema>;

export const lossCarryforwardSetSchema = z
  .object({
    taxYear: z.number().int().min(2000).max(2100),
    entries: z.array(lossCarryforwardEntrySchema).max(2),
  })
  .refine((d) => new Set(d.entries.map((e) => e.pot)).size === d.entries.length, {
    message: "At most one entry per pot",
  });
export type LossCarryforwardSet = z.infer<typeof lossCarryforwardSetSchema>;
