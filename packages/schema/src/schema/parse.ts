import { z } from "zod";
import { assetClassSchema, unitSchema } from "./enums.js";
import { decimalString, currencyCode } from "./primitives.js";

export const taxComponentsSchema = z.object({
  kapitalertragsteuer: decimalString.nullish(),
  solidaritaetszuschlag: decimalString.nullish(),
  kirchensteuer: decimalString.nullish(),
  quellensteuer: decimalString.nullish(),
  stueckzinsen: decimalString.nullish(),
});
export type TaxComponents = z.infer<typeof taxComponentsSchema>;

export const parsedActionSchema = z.enum([
  "buy",
  "sell",
  "dividend",
  "coupon",
  "interest",
  "savings_plan",
  "deposit",
  "withdrawal",
  "bonus",
  "bonus_cash",
  "tax",
  "transfer_in",
  "transfer_out",
]);
export type ParsedAction = z.infer<typeof parsedActionSchema>;

/** Review-screen attention reasons a parsed draft can carry (see `attention` below). */
export const draftAttentionSchema = z.enum(["needs_cost_basis"]);
export type DraftAttention = z.infer<typeof draftAttentionSchema>;

/**
 * Whether a draft is an inbound depot transfer with no carried cost basis (price 0). Such
 * a row would land the shares at zero cost — a later sale would then report 100% gain and
 * fully taxable proceeds — so confirm refuses it until the user enters the basis (audit
 * B4). A `transfer_out`'s row price is never read (it leaves at running average cost).
 */
export function transferNeedsCostBasis(d: { action: string; price: string }): boolean {
  if (d.action !== "transfer_in") return false;
  const price = d.price.trim();
  // Positive iff it is a well-formed, unsigned decimal string with a non-zero digit
  // (string check — no float round-trip of a money value).
  return !(/^\d+(\.\d+)?$/.test(price) && /[1-9]/.test(price));
}

export const parsedTransactionSchema = z.object({
  assetClass: assetClassSchema.nullish(),
  action: parsedActionSchema,
  ticker: z.string().nullish(),
  isin: z.string().nullish(),
  wkn: z.string().nullish(),
  name: z.string().nullish(),
  quantity: decimalString,
  unit: unitSchema.nullish(),
  price: decimalString,
  fees: decimalString.default("0"),
  total: decimalString.nullish(),
  currency: currencyCode,
  executedAt: z.coerce.date(),
  exchangeCode: z.string().nullish(),
  externalId: z.string().nullish(),
  savingsPlanId: z.string().nullish(),
  tax: decimalString.nullish(),
  executedPrice: decimalString.nullish(),
  fxRate: decimalString.nullish(),
  perShare: decimalString.nullish(),
  shares: decimalString.nullish(),
  nativeCurrency: currencyCode.nullish(),
  grossNative: decimalString.nullish(),
  vorabBase: decimalString.nullish(),
  venue: z.string().nullish(),
  kind: z.string().nullish(),
  description: z.string().nullish(),
  documentRefs: z
    .array(
      z.object({
        id: z.string(),
        type: z.string().nullish(),
        date: z.string().nullish(),
      }),
    )
    .nullish(),
  confidence: z.number().min(0).max(1),
  /**
   * Reasons this draft needs the user's attention in the review screen before it can be
   * confirmed. `needs_cost_basis`: an inbound depot transfer whose source carried no
   * acquisition price — the carried cost basis must be entered (confirm rejects a
   * `transfer_in` at price 0 with `transfer_cost_basis_required`; audit B4).
   */
  attention: z.array(draftAttentionSchema).nullish(),
  taxComponents: taxComponentsSchema.nullish(),
  orderRef: z.string().nullish(),
  extraSources: z
    .array(
      z.object({
        externalId: z.string(),
        raw: z.unknown().nullish(),
      }),
    )
    .nullish(),
});
export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;

export const importIssueSchema = z.object({
  message: z.string(),
  severity: z.enum(["info", "attention"]).default("attention"),
  code: z.enum(["unmapped_event_type", "unparseable_event"]).optional(),
  line: z.number().optional(),
  eventId: z.string().optional(),
  eventType: z.string().optional(),
  raw: z
    .object({
      isin: z.string().nullish(),
      wkn: z.string().nullish(),
      name: z.string().nullish(),
      currency: z.string().nullish(),
      executedAt: z.string().nullish(),
      amount: z.number().nullish(),
      shares: z.number().nullish(),
    })
    .nullish(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;
