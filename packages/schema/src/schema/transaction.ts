import { z } from "zod";
import { transactionTypeSchema, transactionSourceSchema } from "./enums.js";
import { decimalString, currencyCode } from "./primitives.js";

export const transactionInputSchema = z
  .object({
    portfolioId: z.guid(),
    instrumentId: z.guid().nullable().optional(),
    type: transactionTypeSchema,
    quantity: decimalString.default("0"),
    price: decimalString.default("0"),
    fees: decimalString.default("0"),
    tax: decimalString.nullable().optional(),
    fxRate: decimalString.nullable().optional(),
    perShare: decimalString.nullable().optional(),
    shares: decimalString.nullable().optional(),
    nativeCurrency: currencyCode.nullable().optional(),
    grossNative: decimalString.nullable().optional(),
    description: z.string().nullable().optional(),
    tags: z.array(z.string()).nullable().optional(),
    currency: currencyCode,
    executedAt: z.coerce.date(),
    source: transactionSourceSchema.default("manual"),
    externalId: z.string().optional(),
    kind: z.string().nullable().optional(),
    // Links a manual `loan_repayment` to a cicilan loan (and optionally one of its schedule
    // installments). `undefined` leaves a stored link unchanged on PATCH; `null` unlinks.
    loanId: z.guid().nullable().optional(),
    installmentN: z.number().int().positive().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "loan_repayment" && (v.loanId != null || v.installmentN != null)) {
      ctx.addIssue({
        code: "custom",
        path: ["loanId"],
        message: "loanId / installmentN are only valid on a loan_repayment",
      });
    }
    if (v.installmentN != null && v.loanId == null) {
      ctx.addIssue({
        code: "custom",
        path: ["installmentN"],
        message: "installmentN requires loanId",
      });
    }
  });
export type TransactionInput = z.infer<typeof transactionInputSchema>;

export const mergerInputSchema = z
  .object({
    portfolioId: z.guid(),
    fromInstrumentId: z.guid(),
    toInstrumentId: z.guid(),
    outQty: decimalString,
    inQty: decimalString,
    executedAt: z.coerce.date(),
    taxable: z.boolean().default(false),
    marketValue: decimalString.optional(),
  })
  .refine((v) => v.fromInstrumentId !== v.toInstrumentId, {
    message: "from and to instruments must differ",
    path: ["toInstrumentId"],
  })
  .refine((v) => !v.taxable || v.marketValue !== undefined, {
    message: "marketValue is required for a taxable merger",
    path: ["marketValue"],
  });
export type MergerInput = z.infer<typeof mergerInputSchema>;
