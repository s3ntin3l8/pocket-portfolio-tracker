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

export const LOW_CONFIDENCE_THRESHOLD = 0.9;
