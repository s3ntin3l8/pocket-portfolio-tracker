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

/** Most transactions one `propose_transactions` call may carry. */
export const MAX_PROPOSED_TRANSACTIONS = 100;

const PROPOSAL_CASH_ACTIONS: ReadonlySet<string> = new Set([
  "deposit",
  "withdrawal",
  "interest",
  "tax",
]);

/**
 * What an AI model may propose for a draft import: the economic fields of a trade and nothing
 * that steers the import itself (no externalId, tax components, document refs, attention
 * flags or confidence — the server sets those). Unknown fields are rejected so a model can't
 * smuggle them in.
 */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO 8601 date or datetime. A string (not `z.coerce.date()`) so it has a JSON Schema form. */
const isoDateString = z
  .string()
  .regex(ISO_DATE, "must be an ISO 8601 date or datetime")
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "must be a real date" })
  .describe("ISO 8601 date or datetime, e.g. 2026-03-02 or 2026-03-02T14:30:00Z");

/** Like `currencyCode` without the upper-casing transform (which has no JSON Schema form). */
const isoCurrency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "must be a 3-letter ISO 4217 currency code")
  .describe("ISO 4217 currency code, e.g. EUR");

export const proposedTransactionSchema = parsedTransactionSchema
  .pick({
    assetClass: true,
    action: true,
    ticker: true,
    isin: true,
    wkn: true,
    name: true,
    quantity: true,
    unit: true,
    price: true,
    fees: true,
    total: true,
    exchangeCode: true,
    description: true,
  })
  .extend({ executedAt: isoDateString, currency: isoCurrency })
  .strict()
  .refine(
    (t) => PROPOSAL_CASH_ACTIONS.has(t.action) || Boolean(t.ticker || t.isin || t.wkn || t.name),
    { message: "a security needs a ticker, isin, wkn or name" },
  );
export type ProposedTransaction = z.infer<typeof proposedTransactionSchema>;

export const proposeTransactionsBodySchema = z
  .object({
    /** Target depot; omitted = the only one, else chosen in the review screen. */
    portfolioId: z.string().uuid().optional(),
    transactions: z.array(proposedTransactionSchema).min(1).max(MAX_PROPOSED_TRANSACTIONS),
  })
  .strict();
export type ProposeTransactionsBody = z.infer<typeof proposeTransactionsBodySchema>;

export interface ProposeTransactionsResult {
  importId: string;
  draftCount: number;
  /** This exact proposal already exists as a draft import. */
  alreadyExists: boolean;
  /** This exact proposal was already confirmed. */
  alreadyConfirmed: boolean;
  /** Drafts that look like a transaction already committed to the target portfolio. */
  likelyDuplicates: number;
  portfolioId: string | null;
  /** Web path of the review screen where the user confirms the drafts. */
  reviewPath: string;
  /** Absolute link to it, when the server knows the web origin (`PUBLIC_WEB_URL`). */
  reviewUrl?: string;
}
