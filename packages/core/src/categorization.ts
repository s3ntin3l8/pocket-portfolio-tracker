export const ACQUISITION_TYPES = ["buy", "savings_plan"] as const;
export const DISPOSAL_TYPES = ["sell"] as const;
export const INCOME_TYPES = ["dividend", "coupon", "interest", "bonus_cash"] as const;
/** The investment-income types the tax views report (both the German "Investment income"
 *  table and the Indonesian final tax). `bonus_cash` is income for performance but a broker
 *  bonus, not a dividend/coupon/interest payment, so it isn't in either tax table. */
export const TAXED_INCOME_TYPES = ["dividend", "coupon", "interest"] as const;
export const CASH_FLOW_TYPES = ["deposit", "withdrawal", "fee", "tax", "adjustment"] as const;
export const SHARE_RECEIPT_TYPES = ["bonus", "split", "rights"] as const;
export const TRANSFER_TYPES = ["transfer_in", "transfer_out"] as const;

export function isTradeType(type: string): boolean {
  return ([...ACQUISITION_TYPES, ...DISPOSAL_TYPES] as readonly string[]).includes(type);
}
export function isAcquisitionType(type: string): boolean {
  return (ACQUISITION_TYPES as readonly string[]).includes(type);
}
export function isDisposalType(type: string): boolean {
  return (DISPOSAL_TYPES as readonly string[]).includes(type);
}
export function isIncomeType(type: string): boolean {
  return (INCOME_TYPES as readonly string[]).includes(type);
}
export function isShareReceiptType(type: string): boolean {
  return (SHARE_RECEIPT_TYPES as readonly string[]).includes(type);
}
export function isTransferType(type: string): boolean {
  return (TRANSFER_TYPES as readonly string[]).includes(type);
}
