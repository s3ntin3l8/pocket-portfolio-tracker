import { z } from "zod";
import { costBasisModeSchema } from "./enums.js";
import { decimalString, currencyCode } from "./primitives.js";

export const loanScheduleRowSchema = z.object({
  n: z.number().int().positive(),
  dueDate: z.coerce.date(),
  pokok: decimalString,
  sewaModal: decimalString,
  angsuran: decimalString,
  sisaPokok: decimalString,
});
export type LoanScheduleRow = z.infer<typeof loanScheduleRowSchema>;

export const parsedGoldContractSchema = z.object({
  provider: z.string().nullish(),
  contractNo: z.string().nullish(),
  currency: currencyCode.default("IDR"),
  grams: decimalString,
  goldName: z.string().nullish(),
  purchasePrice: decimalString,
  downPayment: decimalString.default("0"),
  adminFee: decimalString.default("0"),
  discount: decimalString.default("0"),
  principal: decimalString,
  marginTotal: decimalString.default("0"),
  tenorMonths: z.number().int().positive(),
  monthlyInstallment: decimalString.default("0"),
  startDate: z.coerce.date(),
  costBasisMode: costBasisModeSchema.default("purchase_price"),
  schedule: z.array(loanScheduleRowSchema).default([]),
  confidence: z.number().min(0).max(1).default(1),
});
export type ParsedGoldContract = z.infer<typeof parsedGoldContractSchema>;
