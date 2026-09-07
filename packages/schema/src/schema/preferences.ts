import { z } from "zod";
import { costBasisModeSchema } from "./enums.js";

export const dashboardPeriodSchema = z.enum(["ytd", "1y", "5y", "max"]);
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

export const KPI_KEYS = [
  "netWorth",
  "xirr",
  "dayChange",
  "totalPnL",
  "income",
  "cash",
  "positions",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const taxRegimeSchema = z.enum(["DE", "ID"]);
export type TaxRegime = z.infer<typeof taxRegimeSchema>;

export const benchmarkSymbolEntrySchema = z.object({
  symbol: z.string().min(1).max(32),
  displayName: z.string().min(1).max(128).optional(),
});
export type BenchmarkSymbolEntry = z.infer<typeof benchmarkSymbolEntrySchema>;

/**
 * The set of user-selected reference indices. Capped at 3 entries to keep the
 * per-year comparison table readable and the backfill volume bounded; lifted in
 * a future migration if needed. `displayName` is optional — the server fills in
 * a friendly label from its quick-pick map (or the raw ticker) if absent.
 */
export const benchmarkSymbolsSchema = z
  .array(benchmarkSymbolEntrySchema)
  .min(1, "at least one benchmark is required")
  .max(3, "at most 3 benchmarks");
export type BenchmarkSymbols = z.infer<typeof benchmarkSymbolsSchema>;

export const userPreferencesSchema = z.object({
  dashboardPeriod: dashboardPeriodSchema.optional(),
  dashboardKpis: z.array(z.enum(KPI_KEYS)).max(8).optional(),
  costBasisMode: costBasisModeSchema.optional(),
  taxRegime: taxRegimeSchema.optional(),
  benchmarkSymbols: benchmarkSymbolsSchema.optional(),
  riskFreeRate: z.number().min(0).max(1).nullable().optional(),
  retirementAge: z.number().int().min(50).max(80).nullable().optional(),
});
export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>;
