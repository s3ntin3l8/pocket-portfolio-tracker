import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  corporateActions,
  instruments,
  transactions,
  dismissedAnomalies,
  trConnections,
  ibkrConnections,
  userPreferences,
} from "@portfolio/db";
import {
  type Anomaly,
  type CorporateAction,
  type CostBasisMode,
  type TradeMethod,
  type CoreTransaction,
  type ReconciliationGap,
  detectAnomalies,
  convert,
} from "@portfolio/core";
import { getMarketData } from "../../../services/market-data.js";
import { valuePortfolioCached, type InstrumentMeta } from "../../../services/valuation.js";
import { toCoreTxns } from "../../../services/tx-core.js";
import { netManualAdjustments } from "../../../services/pytr/reconcile.js";
import { withDerivationCache } from "../../../lib/derivation-cache.js";
import {
  getFxRatesForDates,
  makeFxRateFn,
  recordFxMissing,
  type FxProvider,
} from "../../../services/fx.js";
import { anomaliesCache } from "./caches.js";

export function yearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

/** CASE expressions shared by the window-function and aggregate variants of the
 *  summary totals (Invested/Proceeds/Income). Kept in one place so the formulas
 *  can't silently drift between the per-portfolio and networth SQL queries. */
function investedCase(t: typeof transactions): ReturnType<typeof sql> {
  return sql`case when ${t.type} in ('buy','savings_plan') then ${t.price}::numeric * ${t.quantity}::numeric + ${t.fees}::numeric else 0 end`;
}
function proceedsCase(t: typeof transactions): ReturnType<typeof sql> {
  return sql`case when ${t.type} = 'sell' then ${t.price}::numeric * ${t.quantity}::numeric - ${t.fees}::numeric else 0 end`;
}
/**
 * Income as a SQL CASE — must mirror `@portfolio/core`'s `cashFlow()` exactly for the
 * income/tax types (audit B3; parity is pinned by `tx-summary-income-parity.test.ts`):
 * - dividend / coupon / interest / bonus_cash: per-unit when `quantity > 0`, otherwise a
 *   lump sum recorded in `price` (every importer books dividends that way, qty 0), minus
 *   `fees`. The old `price × quantity` valued every lump-sum dividend at 0.
 * - tax: a standalone debit, `−(price + fees)` (quantity ignored).
 * - a `cash_neutral` row moves only its fees (`cashFlow` returns `−fees` for it).
 * Callers pass confirmed rows only (see `list.ts` `summaryConditions`), the same set
 * `cashFlow` is ever fed.
 */
function incomeCase(t: typeof transactions): ReturnType<typeof sql> {
  return sql`case \
    when ${t.type} not in ('dividend','coupon','interest','bonus_cash','tax') then 0 \
    when ${t.status} = 'cash_neutral' then -${t.fees}::numeric \
    when ${t.type} = 'tax' then -(${t.price}::numeric + ${t.fees}::numeric) \
    when ${t.quantity}::numeric > 0 then ${t.price}::numeric * ${t.quantity}::numeric - ${t.fees}::numeric \
    else ${t.price}::numeric - ${t.fees}::numeric end`;
}

export interface TransactionSummary {
  totalInvested: string;
  totalProceeds: string;
  totalIncome: string;
}

/**
 * FX-correct summary totals (Invested/Proceeds/Income), folded to `targetCurrency`.
 *
 * The naive `SUM(price*quantity)` mixes currencies when rows span more than one
 * `transactions.currency` (issue #593) — a EUR + IDR networth view, or a single
 * portfolio holding a foreign-currency instrument. Grouping by `(currency, trade-day)`
 * lets each bucket convert at *that day's* historical rate rather than today's spot
 * rate, matching the row-level `displayRate` convention (#465) and avoiding baking
 * currency drift into "Total Invested" (never manufacture phantom gains).
 *
 * Runs as an independent aggregate query — not tied to pagination — so it's correct
 * across the full filtered set, not just the current page.
 */
export async function computeConvertedSummary(
  app: FastifyInstance,
  conditions: SQL[],
  targetCurrency: string,
  log?: FastifyBaseLogger,
): Promise<TransactionSummary> {
  const dayExpr = sql<string>`(${transactions.executedAt} AT TIME ZONE 'UTC')::date::text`;
  const groups = await app.db
    .select({
      currency: transactions.currency,
      day: dayExpr,
      totalInvested: sql<string>`COALESCE(SUM(${investedCase(transactions)}), '0')`,
      totalProceeds: sql<string>`COALESCE(SUM(${proceedsCase(transactions)}), '0')`,
      totalIncome: sql<string>`COALESCE(SUM(${incomeCase(transactions)}), '0')`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.currency, dayExpr);

  if (groups.length === 0) {
    return { totalInvested: "0", totalProceeds: "0", totalIncome: "0" };
  }

  const currencies = [...new Set(groups.map((g) => g.currency))];
  const days = [...new Set(groups.map((g) => g.day))];
  const ratesByDate = await getFxRatesForDates(app.db, currencies, targetCurrency, days);
  // One rate function per day — groups sharing a day share the same fx lookup.
  const fxByDay = new Map(
    days.map((d) => [d, makeFxRateFn(ratesByDate.get(d) ?? {}, targetCurrency)]),
  );

  const missing: { currency: string; day: string }[] = [];
  let totalInvested = new Decimal(0);
  let totalProceeds = new Decimal(0);
  let totalIncome = new Decimal(0);
  for (const g of groups) {
    if (g.currency !== targetCurrency && !ratesByDate.get(g.day)?.[g.currency]) {
      // No rate: exclude the bucket (never 1:1, audit B2); reported below and as the
      // response's fxMissingCurrencies.
      missing.push({ currency: g.currency, day: g.day });
      recordFxMissing([g.currency]);
      continue;
    }
    const fx = fxByDay.get(g.day)!;
    totalInvested = totalInvested.plus(convert(g.totalInvested, g.currency, targetCurrency, fx));
    totalProceeds = totalProceeds.plus(convert(g.totalProceeds, g.currency, targetCurrency, fx));
    totalIncome = totalIncome.plus(convert(g.totalIncome, g.currency, targetCurrency, fx));
  }
  // One aggregated warning per request, not one per unrated bucket.
  if (missing.length > 0) {
    log?.warn(
      { targetCurrency, missing },
      "computeConvertedSummary: no FX rate for some buckets, excluded from the totals",
    );
  }

  const fxMissingCurrencies = [...new Set(missing.map((m) => m.currency))].sort();
  return {
    totalInvested: totalInvested.toString(),
    totalProceeds: totalProceeds.toString(),
    totalIncome: totalIncome.toString(),
    ...(fxMissingCurrencies.length > 0 ? { fxMissingCurrencies } : {}),
  };
}

export interface PortfolioParams {
  portfolioId: string;
}

export const PORTFOLIO_VALUATION_CONCURRENCY = 4;

export const bulkDeleteSchema = z.object({
  ids: z.array(z.guid()).min(1),
});

export async function corporateActionsFor(
  app: FastifyInstance,
  instrumentIds: (string | null)[],
  portfolioId?: string,
): Promise<CorporateAction[]> {
  const ids = [...new Set(instrumentIds.filter((x): x is string => x !== null))];
  if (ids.length === 0) return [];
  const rows = await app.db
    .select()
    .from(corporateActions)
    .where(
      and(
        inArray(corporateActions.instrumentId, ids),
        ...(portfolioId
          ? [
              or(
                isNull(corporateActions.portfolioId),
                eq(corporateActions.portfolioId, portfolioId),
              ),
            ]
          : []),
      ),
    );
  return rows.map((r) => ({
    instrumentId: r.instrumentId,
    type: r.type,
    ratio: r.ratio,
    exDate: new Date(r.exDate),
    portfolioId: r.portfolioId,
    targetInstrumentId: r.targetInstrumentId ?? undefined,
    ratioTo: r.ratioTo ?? undefined,
    taxableMarketValue: r.taxableMarketValue ?? undefined,
  }));
}

/**
 * A `position_gap` is detected from the broker feed, which only knows ISINs. Resolve each to
 * the instrument so the banner can name it and link to its page — into `meta`, NOT
 * `Anomaly.instrumentId`: that field marks an anomaly as belonging to one instrument's own
 * transactions (the instrument page filters on it), and a portfolio-level gap isn't that.
 * `instruments.isin` is unique, so a global lookup is exact. An unknown ISIN just stays as is.
 */
async function attachPositionGapInstruments(app: FastifyInstance, anomalies: Anomaly[]) {
  const gaps = anomalies.filter((a) => a.code === "position_gap" && a.meta?.isin);
  if (gaps.length === 0) return;
  const found = await app.db
    .select({ id: instruments.id, isin: instruments.isin, symbol: instruments.symbol })
    .from(instruments)
    .where(inArray(instruments.isin, [...new Set(gaps.map((a) => String(a.meta?.isin)))]));
  const byIsin = new Map(found.map((i) => [i.isin, i]));
  for (const a of gaps) {
    const inst = byIsin.get(String(a.meta?.isin));
    if (inst) a.meta = { ...a.meta, instrumentId: inst.id, symbol: inst.symbol };
  }
}

export async function computePortfolioAnomalies(
  app: FastifyInstance,
  portfolio: { id: string; cashCounted: boolean; allowNegativeCash: boolean },
): Promise<Anomaly[]> {
  const { filtered } = await withDerivationCache(anomaliesCache, portfolio.id, async () => {
    const [rows, trConn, ibkrConn, dismissed] = await Promise.all([
      app.db.select().from(transactions).where(eq(transactions.portfolioId, portfolio.id)),
      app.db
        .select({ lastReconciliation: trConnections.lastReconciliation })
        .from(trConnections)
        .where(eq(trConnections.portfolioId, portfolio.id))
        .limit(1)
        .then((r) => r[0] ?? null),
      // IBKR reports its own cash reconciliation gap in the same shape as TR. Reading only
      // the TR connection left the whole reconciliation block of `detectAnomalies` blind to
      // IBKR — no gap banner, no anomaly count, no Activity badge.
      app.db
        .select({ lastReconciliation: ibkrConnections.lastReconciliation })
        .from(ibkrConnections)
        .where(eq(ibkrConnections.portfolioId, portfolio.id))
        .limit(1)
        .then((r) => r[0] ?? null),
      app.db
        .select({
          transactionId: dismissedAnomalies.transactionId,
          code: dismissedAnomalies.code,
        })
        .from(dismissedAnomalies)
        .where(eq(dismissedAnomalies.portfolioId, portfolio.id)),
    ]);
    const coreTxns: CoreTransaction[] = toCoreTxns(rows);
    const cas = await corporateActionsFor(
      app,
      rows.map((r) => r.instrumentId),
      portfolio.id,
    );
    const rawReconciliation = trConn?.lastReconciliation as ReconciliationGap | null | undefined;
    const reconciliation = rawReconciliation
      ? netManualAdjustments(rawReconciliation, coreTxns)
      : rawReconciliation;
    const rawIbkrReconciliation = ibkrConn?.lastReconciliation as
      ReconciliationGap | null | undefined;
    const ibkrReconciliation = rawIbkrReconciliation
      ? netManualAdjustments(rawIbkrReconciliation, coreTxns)
      : rawIbkrReconciliation;
    // One gap per connected broker — a portfolio can have both.
    const reconciliationGaps: ReconciliationGap[] = [];
    if (reconciliation) reconciliationGaps.push({ ...reconciliation, broker: "tr" });
    if (ibkrReconciliation) reconciliationGaps.push({ ...ibkrReconciliation, broker: "ibkr" });
    const anomalies = detectAnomalies(coreTxns, cas, {
      cashCounted: portfolio.cashCounted,
      allowNegativeCash: portfolio.allowNegativeCash,
      reconciliationGap: reconciliationGaps.length > 0 ? reconciliationGaps : null,
    });
    // Portfolio-level anomalies (broker reconciliation gaps) carry no transaction to point
    // at; tag them with their portfolio so the aggregate view can tell them apart and link
    // to the right place.
    for (const a of anomalies) {
      if (a.scope === "portfolio") a.meta = { ...a.meta, portfolioId: portfolio.id };
    }
    await attachPositionGapInstruments(app, anomalies);
    const dismissedSet = new Set(dismissed.map((d) => `${d.transactionId}:${d.code}`));
    const filtered = anomalies.filter(
      (a) => !(a.transactionId && dismissedSet.has(`${a.transactionId}:${a.code}`)),
    );
    return { filtered };
  });
  return filtered;
}

export async function instrumentMeta(
  app: FastifyInstance,
  ids: (string | null)[],
): Promise<Map<string, InstrumentMeta>> {
  const unique = [...new Set(ids.filter((x): x is string => x !== null))];
  if (!unique.length) return new Map();
  const rows = await app.db.select().from(instruments).where(inArray(instruments.id, unique));
  return new Map(
    rows.map((i) => [
      i.id,
      {
        symbol: i.symbol,
        name: i.name,
        displayName: i.displayName ?? null,
        assetClass: i.assetClass,
        unit: i.unit,
        market: i.market,
        isin: i.isin ?? null,
        sector: i.sector ?? null,
        sectorWeights: (i.sectorWeights as Record<string, number> | null) ?? null,
        countryWeights: (i.countryWeights as Record<string, number> | null) ?? null,
        sectorCheckedAt: i.sectorCheckedAt ? new Date(i.sectorCheckedAt) : null,
        partialExemptionRate: i.partialExemptionRate ?? null,
        country: i.country ?? null,
        industry: i.industry ?? null,
      },
    ]),
  );
}

export async function loadValuation(
  app: FastifyInstance,
  portfolioId: string,
  displayCurrency: string,
  costBasisMode?: CostBasisMode,
  cashCounted = true,
  log?: FastifyBaseLogger,
  /** `null` = cached FX rates only (read-scoped PAT, audit A7); default the provider. */
  fxProvider?: FxProvider | null,
) {
  return valuePortfolioCached(
    app.db,
    await getMarketData(),
    app.config.MARKET_DATA_TTL_MS,
    portfolioId,
    displayCurrency,
    costBasisMode,
    cashCounted,
    undefined,
    log,
    fxProvider,
  );
}

export function costBasisFromQuery(q: { costBasis?: string }): CostBasisMode | undefined {
  return q.costBasis === "total_paid" || q.costBasis === "purchase_price" ? q.costBasis : undefined;
}

/**
 * Cost-basis mode for a request: an explicit valid `?costBasis=` wins; otherwise the
 * user's saved `userPreferences.costBasisMode`. `purchase_price` (the default) maps to
 * `undefined` so derivation-cache keys stay identical to the pre-preference behaviour.
 */
export async function resolveCostBasisMode(
  app: FastifyInstance,
  userId: string,
  query: { costBasis?: string } = {},
): Promise<CostBasisMode | undefined> {
  const fromQuery = costBasisFromQuery(query);
  if (fromQuery !== undefined) return fromQuery;
  const [row] = await app.db
    .select({ costBasisMode: userPreferences.costBasisMode })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.costBasisMode === "total_paid" ? "total_paid" : undefined;
}

/**
 * The user's global tax regime (`userPreferences.taxRegime`); anything but `"ID"` is `"DE"`
 * (the default). Part of every cache key whose value depends on the regime.
 */
export async function resolveTaxRegime(app: FastifyInstance, userId: string): Promise<"DE" | "ID"> {
  const [row] = await app.db
    .select({ taxRegime: userPreferences.taxRegime })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.taxRegime === "ID" ? "ID" : "DE";
}

export function methodFromQuery(q: { method?: string }): TradeMethod {
  return q.method === "fifo" ? "fifo" : "average";
}
