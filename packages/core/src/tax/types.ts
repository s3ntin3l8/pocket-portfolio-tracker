import type { TradeLog, Trade } from "../trade-log.js";

export type { TradeLog, Trade };

export interface PotUsage {
  netGainLoss: string;
  carryForwardApplied: string;
  used: string;
}

export interface AllowanceUsage {
  year: number;
  allowanceAnnual: string;
  realizedGainsAdjusted: string;
  incomeYtd: string;
  vorabpauschaleAccrued: string;
  vorabpauschaleCredited: string;
  stockPot: PotUsage;
  generalPot: PotUsage;
  usedYtd: string;
  taxableExcess: string;
  remaining: string;
  taxRate: string;
  taxSavingAvailable: string;
  currency: string;
  forecastIncomeRestOfYear: string;
  projectedUsedFullYear: string;
  projectedRemaining: string;
  projectedTaxSavingAvailable: string;
}

export interface HarvestSuggestion {
  instrumentId: string;
  unrealizedGross: string;
  tfRate: string;
  unrealizedAdjusted: string;
  harvestableGross: string;
  taxSaving: string;
}

export interface HarvestPlanStep {
  instrumentId: string;
  grossTake: string;
  adjustedTake: string;
}

export interface HarvestSummary {
  positionsUsed: number;
  combinedHarvestableGross: string;
  combinedTaxSaving: string;
  plan: HarvestPlanStep[];
}

export interface AllowanceUsageInput {
  tradeLog: TradeLog;
  tfRates: Record<string, string | number>;
  allowanceAnnual: string;
  taxRate?: string;
  year?: number;
  forecastIncomeRestOfYear?: string;
  assetClasses?: Record<string, string>;
  lossCarryForward?: { stock?: string; general?: string };
}

export interface HarvestSuggestionsInput extends AllowanceUsageInput {
  usage?: AllowanceUsage;
}
