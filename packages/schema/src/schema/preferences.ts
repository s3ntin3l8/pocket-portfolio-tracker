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

export const userPreferencesSchema = z.object({
  dashboardPeriod: dashboardPeriodSchema.optional(),
  dashboardKpis: z.array(z.enum(KPI_KEYS)).max(8).optional(),
  costBasisMode: costBasisModeSchema.optional(),
  taxRegime: taxRegimeSchema.optional(),
  benchmarkSymbol: z.string().nullable().optional(),
  riskFreeRate: z.number().min(0).max(1).nullable().optional(),
  retirementAge: z.number().int().min(50).max(80).nullable().optional(),
});
export type UserPreferencesInput = z.infer<typeof userPreferencesSchema>;
