import { z } from "zod";
import { taxComponentsSchema } from "./parse.js";

/**
 * Response schemas for the read endpoints the web leans on hardest: `/networth`,
 * `/portfolios/:id/summary` and the paginated transaction lists. They describe what the
 * routes actually serialize (not what the client interfaces claim), and are used twice:
 * by `@portfolio/api-client` to validate responses when `validateResponses` is on, and by
 * the API route tests to lock the contract.
 *
 * Objects are `looseObject`: rows spread raw Drizzle columns and the API may add fields
 * without breaking older clients — only the fields a consumer reads are pinned.
 */

/**
 * A decimal in the string form the API emits. Looser than the input-side
 * `decimalString`: Decimal.js prints values below 1e-7 / above 1e21 in exponent form
 * (`"1e-8"`), which is a valid money string on the way out.
 */
export const decimalOut = z.string().regex(/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i);

const decimalOutNullable = decimalOut.nullable();

export const instrumentMetaResponseSchema = z.looseObject({
  symbol: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  assetClass: z.string(),
  unit: z.string(),
  market: z.string(),
  sector: z.string().nullable(),
  sectorWeights: z.record(z.string(), z.number()).nullable(),
  countryWeights: z.record(z.string(), z.number()).nullable(),
  country: z.string().nullable(),
  industry: z.string().nullable(),
});

export const allocationSliceResponseSchema = z.looseObject({
  key: z.string(),
  value: decimalOut,
  pct: z.number(),
});

export const allocationBreakdownResponseSchema = z.looseObject({
  byAssetClass: z.array(allocationSliceResponseSchema),
  byCurrency: z.array(allocationSliceResponseSchema),
  byRegion: z.array(allocationSliceResponseSchema),
  byCountry: z.array(allocationSliceResponseSchema),
  bySector: z.array(allocationSliceResponseSchema),
  byIndustry: z.array(allocationSliceResponseSchema),
  topHoldings: z.array(
    z.looseObject({
      instrumentId: z.string(),
      name: z.string().optional(),
      assetClass: z.string().optional(),
      value: decimalOut,
      pct: z.number(),
    }),
  ),
  concentration: z.looseObject({
    hhi: z.number(),
    top1Pct: z.number(),
    top5Pct: z.number(),
    label: z.enum(["diversified", "moderate", "concentrated"]),
  }),
});

export const driftRowResponseSchema = z.looseObject({
  key: z.string(),
  label: z.string().optional(),
  targetPct: z.number(),
  actualPct: z.number(),
  driftPct: z.number(),
  actualValue: decimalOut,
  status: z.enum(["over", "under", "on_target"]),
});

export const gainSummaryResponseSchema = z.looseObject({
  displayCurrency: z.string(),
  boundary: z.enum(["inside", "outside", "mixed"]),
  value: decimalOut,
  costOfOpen: decimalOut,
  netContributed: decimalOut,
  unrealized: decimalOut,
  realized: decimalOut,
  income: decimalOut,
});

export const holdingValuationResponseSchema = z.looseObject({
  instrumentId: z.string(),
  quantity: decimalOut,
  avgCost: decimalOut,
  costBasis: decimalOut,
  realizedPnL: decimalOut,
  costCurrency: z.string().nullable(),
  price: decimalOutNullable,
  currency: z.string().nullable(),
  marketValue: decimalOutNullable,
  unrealizedPnL: decimalOutNullable,
  marketValueDisplay: decimalOutNullable,
  costBasisDisplay: decimalOut,
  unrealizedPnLDisplay: decimalOutNullable,
  valuedAtCost: z.boolean().optional(),
  fxMissing: z.boolean().optional(),
  previousClose: decimalOutNullable,
  dayChange: decimalOutNullable,
  dayChangePct: decimalOutNullable,
  instrument: instrumentMetaResponseSchema.nullable(),
  lots: z
    .array(
      z.looseObject({
        acqDate: z.string(),
        qty: decimalOut,
        unitCost: decimalOut,
        cost: decimalOut,
      }),
    )
    .optional(),
  sparkline: z.array(z.number()).optional(),
});

/** The valuation block `/networth` and `/portfolios/:id/summary` share. */
const valuationShape = {
  displayCurrency: z.string(),
  holdings: z.array(holdingValuationResponseSchema),
  cash: z.record(z.string(), decimalOut),
  cashTracked: z.boolean(),
  netWorth: decimalOut,
  totalCost: decimalOut,
  totalMarketValue: decimalOut,
  totalUnrealizedPnL: decimalOut,
  totalRealizedPnL: decimalOut,
  totalLiabilities: decimalOut,
  totalIncome: decimalOut,
  totalDayChange: decimalOut,
  exposureByCurrency: z.record(z.string(), decimalOut),
  /** Always present on these endpoints (empty when every FX rate resolved). */
  fxMissingCurrencies: z.array(z.string()),
  allocation: allocationBreakdownResponseSchema.optional(),
  drift: z.record(z.string(), z.array(driftRowResponseSchema)).optional(),
  gain: gainSummaryResponseSchema.optional(),
};

/** `GET /portfolios/:id/summary`. */
export const portfolioSummaryResponseSchema = z.looseObject(valuationShape);

/** `GET /networth`. */
export const netWorthResponseSchema = z.looseObject({
  ...valuationShape,
  xirr: z.number().nullable(),
  periodXirr: z.number().nullable().optional(),
  periodPnL: decimalOutNullable.optional(),
  periodPnLPct: decimalOutNullable.optional(),
  period: z.string().optional(),
  portfolioCount: z.number(),
  asOf: z.string(),
});

export const sourceSummaryResponseSchema = z.looseObject({
  id: z.string(),
  sourceType: z.string(),
  externalId: z.string().nullable(),
  orderRef: z.string().nullable(),
  documentId: z.string().nullable(),
  taxComponents: taxComponentsSchema.nullable(),
  createdAt: z.string(),
  filename: z.string().nullable(),
  hasDocument: z.boolean(),
});

const transactionRowBase = {
  id: z.string(),
  portfolioId: z.string(),
  instrumentId: z.string().nullable(),
  type: z.string(),
  quantity: decimalOut,
  price: decimalOut,
  fees: decimalOut,
  tax: decimalOutNullable,
  fxRate: decimalOutNullable,
  perShare: decimalOutNullable.optional(),
  shares: decimalOutNullable.optional(),
  nativeCurrency: z.string().nullable().optional(),
  grossNative: decimalOutNullable.optional(),
  sharesEstimated: z.boolean().optional(),
  description: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  currency: z.string(),
  executedAt: z.string(),
  source: z.string(),
  kind: z.string().nullable(),
  status: z.enum(["normal", "archived", "cash_neutral", "draft"]),
  importId: z.string().nullable(),
  externalId: z.string().nullable(),
  loanId: z.string().nullable().optional(),
  installmentN: z.number().nullable().optional(),
  instrument: instrumentMetaResponseSchema.nullable(),
  needsReview: z.boolean().optional(),
  sources: z.array(sourceSummaryResponseSchema),
  displayRate: decimalOut.optional(),
  displayCurrency: z.string().optional(),
  fxMissing: z.boolean().optional(),
};

/** A row of `GET /portfolios/:id/transactions`. */
export const transactionRowResponseSchema = z.looseObject({
  ...transactionRowBase,
  hasDocument: z.boolean(),
  hasFullTaxDetail: z.boolean(),
});

/** A row of `GET /networth/transactions` — enriched differently from the per-portfolio list. */
export const networthTransactionRowResponseSchema = z.looseObject({
  ...transactionRowBase,
  hasSources: z.boolean(),
  fullTaxDetail: z.boolean(),
  documentRetained: z.boolean(),
  portfolioName: z.string(),
});

/** Activity header totals. `fxMissingCurrencies` is only present when non-empty. */
export const transactionSummaryResponseSchema = z.looseObject({
  totalInvested: decimalOut,
  totalProceeds: decimalOut,
  totalIncome: decimalOut,
  fxMissingCurrencies: z.array(z.string()).optional(),
});

function paginated<R extends z.ZodType>(row: R) {
  return z.looseObject({
    rows: z.array(row),
    total: z.number(),
    // Absent for an empty networth scope (`{ rows: [], total: 0 }`).
    summary: transactionSummaryResponseSchema.optional(),
    years: z.array(z.string()).optional(),
    /** Drafts matching the non-status filters (the "Drafts only" chip count). */
    draftCount: z.number().optional(),
  });
}

/** `GET /portfolios/:id/transactions?page=…`. */
export const paginatedTransactionsResponseSchema = paginated(transactionRowResponseSchema);

/** `GET /networth/transactions?page=…`. */
export const paginatedNetworthTransactionsResponseSchema = paginated(
  networthTransactionRowResponseSchema,
);

export type NetWorthResponse = z.infer<typeof netWorthResponseSchema>;
export type PortfolioSummaryResponse = z.infer<typeof portfolioSummaryResponseSchema>;
export type PaginatedTransactionsResponse = z.infer<typeof paginatedTransactionsResponseSchema>;
export type PaginatedNetworthTransactionsResponse = z.infer<
  typeof paginatedNetworthTransactionsResponseSchema
>;
