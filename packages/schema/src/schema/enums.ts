import { z } from "zod";

export const assetClassSchema = z.enum([
  "equity",
  "gold",
  "bond",
  "mutual_fund",
  "etf",
  "crypto",
  "derivative",
]);
export type AssetClass = z.infer<typeof assetClassSchema>;

export const unitSchema = z.enum(["shares", "grams", "units"]);
export type Unit = z.infer<typeof unitSchema>;

export const couponScheduleSchema = z.enum(["monthly", "quarterly", "semiannual", "annual"]);
export type CouponSchedule = z.infer<typeof couponScheduleSchema>;

export const transactionTypeSchema = z.enum([
  "buy",
  "sell",
  "dividend",
  "coupon",
  "interest",
  "fee",
  "tax",
  "split",
  "bonus",
  "rights",
  "savings_plan",
  "deposit",
  "withdrawal",
  "bonus_cash",
  "loan_drawdown",
  "loan_repayment",
  "transfer_in",
  "transfer_out",
  "adjustment",
]);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const costBasisModeSchema = z.enum(["purchase_price", "total_paid"]);
export type CostBasisMode = z.infer<typeof costBasisModeSchema>;

export const transactionSourceSchema = z.enum(["screenshot", "csv", "manual", "pytr", "pdf"]);
export type TransactionSource = z.infer<typeof transactionSourceSchema>;

/**
 * Display/merge order of a transaction's sources: the broker feed first, then file imports, manual
 * last. One table for both sides: the API orders `transaction_sources` rows with it (ties on
 * `created_at`, which also decides which source wins the last-wins tax-component merge) and the web
 * orders the badges with it. A source type missing here ranks {@link SOURCE_RANK_DEFAULT}; the API
 * test asserts every `tx_source_type` value has an entry, so a new one cannot slip in silently.
 */
export const SOURCE_RANK: Readonly<Record<string, number>> = {
  pytr: 0,
  ibkr: 0,
  csv: 1,
  screenshot: 2,
  pdf: 3,
  manual: 9,
};

export const SOURCE_RANK_DEFAULT = 5;

export function sourceRank(sourceType: string): number {
  return SOURCE_RANK[sourceType] ?? SOURCE_RANK_DEFAULT;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.9;
