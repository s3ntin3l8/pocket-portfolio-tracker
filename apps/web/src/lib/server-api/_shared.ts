import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createApiClient } from "@portfolio/api-client";
import type { IdCashIncomeSource } from "@portfolio/core";
import type {
  ApiClient,
  Portfolio,
  AccountHolder,
  User,
  Anomaly,
  NetWorth,
  PortfolioSummary,
  PortfolioPerformance,
  Transaction,
  HoldingValuation,
  Instrument,
  Candle,
  CorporateAction,
  InsightsResponse,
  TaxSummaryHolder,
} from "@portfolio/api-client";
import {
  SELECTED_PORTFOLIO_COOKIE,
  SCOPE_HEADER,
  resolveScope,
  qualifyingHolders,
  parseScopeParam,
  formatScopeParam,
  type ScopeSelection,
} from "@/lib/portfolio-selection";
import { toApiRange, type InstrumentPriceRange } from "@/lib/instrument-price-range";
import { accessTokenFromCookieHeader } from "@/lib/session-token";
import { firstForwardedHop } from "@/lib/client-ip";
import { isDevAuthBypass } from "@/lib/dev-auth";
import { classifyFailure, type DataFailure, type DataFailureStatus } from "@/lib/data-status";

export type Scope = ScopeSelection;

/**
 * The `?scope=` value the proxy surfaced as a request header (null when the URL carries no
 * valid scope — loaders have no access to `searchParams`).
 */
async function scopeHeaderValue(): Promise<string | null> {
  try {
    return (await headers()).get(SCOPE_HEADER);
  } catch {
    // No request scope — fall through to the cookie.
    return null;
  }
}

/** The `pf` cookie: the default scope for scope-less URLs. */
async function scopeCookieValue(): Promise<string | null> {
  try {
    return (await cookies()).get(SELECTED_PORTFOLIO_COOKIE)?.value ?? null;
  } catch {
    // No request context (e.g. a build-time render) — no cookie scope.
    return null;
  }
}

/**
 * The scope for this request: a valid `?scope=` URL param (surfaced by the proxy as a
 * request header — loaders have no access to `searchParams`) wins over the `pf` cookie,
 * which stays the default for scope-less URLs.
 */
async function getRawScope(): Promise<Scope> {
  return resolveScope({ param: await scopeHeaderValue(), cookie: await scopeCookieValue() });
}

/**
 * The scope of the current request as a discriminated value (`all` | `portfolio` | `holder`).
 *
 * `getSelectedPortfolioId()` answers a narrower question ("which single portfolio?") and
 * answers `null` for BOTH "all portfolios" and "a holder scope" — the conflation that let
 * the Activity ledger aggregate a holder scope (audit R4-C1). Callers that must tell the
 * three cases apart ask for the scope instead.
 */
export async function getScopeSelection(): Promise<Scope> {
  return getRawScope();
}

/**
 * The scope a page should actually render.
 *
 * A holder scope only counts for a holder that owns ≥2 portfolios (the switcher's rule):
 * a single-portfolio holder is equivalent to that one portfolio, so a scope naming one
 * falls back to the aggregate — exactly like every other scope-aware page.
 */
export async function resolveEffectiveScope(
  portfolios: { accountHolderId?: string | null }[],
): Promise<Scope> {
  const scope = await getScopeSelection();
  if (scope.kind !== "holder") return scope;
  const count = portfolios.filter((p) => p.accountHolderId === scope.holderId).length;
  return count >= 2 ? scope : { kind: "all" };
}

/**
 * The `?scope=` value a legacy `?portfolio=<id>` deep link should be translated to.
 *
 * `?scope=p:<id>` is the documented encoding; `?portfolio=` was the Holdings page's own
 * drill-in parameter, which overrode ONLY the positions table while the hero, the
 * allocation and the sidebar net worth followed `?scope=` (audit R4-C2). A valid `?scope=`
 * wins; otherwise the legacy parameter becomes `p:<id>`. Null when there is no legacy
 * parameter to translate (nothing to redirect) or when it names no valid portfolio.
 */
export function legacyScopeValue(input: {
  scope?: string | null;
  portfolio?: string | null;
}): string | null {
  if (!input.portfolio) return null;
  const explicit = parseScopeParam(input.scope);
  if (explicit) return formatScopeParam(explicit);
  const legacy = parseScopeParam(`p:${input.portfolio}`);
  return legacy ? formatScopeParam(legacy) : null;
}

export async function getSelectedPortfolioId(): Promise<string | null> {
  const scope = await getRawScope();
  return scope.kind === "portfolio" ? scope.portfolioId : null;
}

const apiBaseUrl = process.env.API_URL ?? "";
// AUTH_LOCAL_SECRET counts as configured auth too: local password login mints the same
// session cookie, and gating on AUTHENTIK_ISSUER alone left every RSC read tokenless —
// each one degraded to "unavailable" ("Can't reach the API") while the same-origin proxy,
// which reads the cookie ungated, happily served the identical data client-side.
const authConfigured = Boolean(
  process.env.AUTH_SECRET && (process.env.AUTHENTIK_ISSUER || process.env.AUTH_LOCAL_SECRET),
);
// DEV_AUTH_TOKEN is a dev-only bypass — never active in production (same NODE_ENV
// guard pattern as isAllowedHost in apps/web/src/proxy.ts).
const devToken = isDevAuthBypass() ? process.env.DEV_AUTH_TOKEN : undefined;

const getServerApi = cache(async (): Promise<ApiClient | null> => {
  let token: string | null = null;
  if (devToken) {
    token = devToken;
  } else if (authConfigured) {
    const cookieHeader = (await cookies())
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    token = await accessTokenFromCookieHeader(cookieHeader);
  }
  if (!token) return null;
  // Forward the end user's IP (first x-forwarded-for hop, as the browser proxy does).
  // Without it every server-rendered page of every user reaches the API from this
  // container's single IP. The API only trusts it from proxies in TRUSTED_PROXY_CIDRS.
  // Read once: getServerApi is request-cached, so every loader in this request shares this
  // client (and this snapshot of the header) rather than calling headers() per loader.
  let clientIp: string | null = null;
  try {
    clientIp = firstForwardedHop(await headers());
  } catch {
    // No request scope (e.g. a build-time render) — nothing to forward.
  }
  return createApiClient({
    baseUrl: apiBaseUrl,
    getToken: () => token,
    // Contract check against the @portfolio/schema response schemas — dev/test only.
    validateResponses: process.env.NODE_ENV !== "production",
    ...(clientIp ? { headers: { "x-forwarded-for": clientIp } } : {}),
  });
});

function normalizeCostBasis(
  costBasis?: "purchase_price" | "total_paid",
): "purchase_price" | "total_paid" {
  return costBasis ?? "purchase_price";
}

const listPortfoliosCached = cache(async (): Promise<Portfolio[]> => {
  const api = await getServerApi();
  if (!api) return [];
  return api.listPortfolios();
});

const listAccountHoldersCached = cache(async (): Promise<AccountHolder[]> => {
  const api = await getServerApi();
  if (!api) return [];
  return api.listAccountHolders();
});

const meCached = cache(async (): Promise<User | null> => {
  const api = await getServerApi();
  if (!api) return null;
  return api.me();
});

const getSummaryCached = cache(
  async (
    portfolioId: string,
    costBasis: "purchase_price" | "total_paid",
  ): Promise<PortfolioSummary> => {
    const api = await getServerApi();
    if (!api) throw new Error("api unavailable");
    return api.getSummary(portfolioId, costBasis);
  },
);

const getPerformanceCached = cache(async (portfolioId: string): Promise<PortfolioPerformance> => {
  const api = await getServerApi();
  if (!api) throw new Error("api unavailable");
  return api.getPerformance(portfolioId);
});

const getNetWorthCached = cache(
  async (
    costBasis: "purchase_price" | "total_paid",
    holderId: string | undefined,
    period: string,
  ): Promise<NetWorth> => {
    const api = await getServerApi();
    if (!api) throw new Error("api unavailable");
    return api.getNetWorth(costBasis, holderId, period);
  },
);

export type NetWorthResult = { status: "ok"; data: NetWorth } | { status: "empty" } | DataFailure;

export interface PortfolioWithValue {
  portfolio: Portfolio;
  netWorth: string;
}

export interface Selection {
  status: "ok" | "unavailable";
  portfolios: Portfolio[];
  selectedId: string | null;
  selectedHolderId: string | null;
}

export async function resolveSelection(): Promise<Selection> {
  const api = await getServerApi();
  if (!api)
    return { status: "unavailable", portfolios: [], selectedId: null, selectedHolderId: null };
  try {
    const [portfolios, holders] = await Promise.all([
      listPortfoliosCached(),
      listAccountHoldersCached(),
    ]);
    const rawScope = await getRawScope();

    if (rawScope.kind === "portfolio") {
      const selectedId = portfolios.some((p) => p.id === rawScope.portfolioId)
        ? rawScope.portfolioId
        : null;
      return { status: "ok", portfolios, selectedId, selectedHolderId: null };
    }

    if (rawScope.kind === "holder") {
      const qualifying = qualifyingHolders(portfolios, holders);
      const selectedHolderId = qualifying.some((h) => h.id === rawScope.holderId)
        ? rawScope.holderId
        : null;
      return { status: "ok", portfolios, selectedId: null, selectedHolderId };
    }

    return { status: "ok", portfolios, selectedId: null, selectedHolderId: null };
  } catch {
    return { status: "unavailable", portfolios: [], selectedId: null, selectedHolderId: null };
  }
}

/**
 * The holder scope the aggregate views are filtered to (undefined when a single portfolio
 * is selected or no multi-portfolio holder scope is active).
 */
export async function resolveHolderScope(
  portfolios: { accountHolderId?: string | null }[],
): Promise<string | undefined> {
  const scope = await resolveEffectiveScope(portfolios);
  return scope.kind === "holder" ? scope.holderId : undefined;
}

export interface TransactionWithPortfolio extends Transaction {
  portfolioName: string;
}

/**
 * The anomalies of one portfolio — the "Needs review" set of a single-portfolio scope.
 * `portfolioOverride` wins over the scope's own portfolio.
 */
export const loadAnomalies = cache(
  async (portfolioOverride?: string): Promise<Anomaly[] | null> => {
    const api = await getServerApi();
    if (!api) return null;
    const portfolioId = portfolioOverride ?? (await getSelectedPortfolioId());
    if (!portfolioId) return null;
    try {
      const { anomalies } = await api.getAnomalies(portfolioId);
      return anomalies;
    } catch {
      return null;
    }
  },
);

/**
 * Aggregate variant of {@link loadAnomalies} for the all-portfolios Activity view (#562) —
 * backs the "Needs review" banner/chip when no single portfolio is selected.
 */
export const loadNetworthAnomalies = cache(async (): Promise<Anomaly[] | null> => {
  const api = await getServerApi();
  if (!api) return null;
  try {
    const { anomalies } = await api.getNetworthAnomalies();
    return anomalies;
  } catch {
    return null;
  }
});

/**
 * The anomalies of one account holder's portfolios — a holder scope's "Needs review" set.
 *
 * The aggregate `/networth/anomalies` endpoint has no holder filter, so a holder scope is
 * composed from the holder's own portfolios: the same set the Activity ledger shows.
 */
export const loadHolderAnomalies = cache(async (holderId: string): Promise<Anomaly[] | null> => {
  const portfolios = (await listPortfoliosCached()).filter((p) => p.accountHolderId === holderId);
  if (portfolios.length === 0) return [];
  const lists = await Promise.all(portfolios.map((p) => loadAnomalies(p.id)));
  return lists.flatMap((list) => list ?? []);
});

/**
 * The anomalies of a scope: one portfolio, one holder's portfolios, or the all-portfolios
 * aggregate. The scope-aware entry point every "Needs review" surface uses, so the badge
 * and the Activity page can never disagree about which anomalies are in scope.
 */
export async function loadScopeAnomalies(scope: Scope): Promise<Anomaly[] | null> {
  if (scope.kind === "portfolio") return loadAnomalies(scope.portfolioId);
  if (scope.kind === "holder") return loadHolderAnomalies(scope.holderId);
  return loadNetworthAnomalies();
}

/** The API's page-size cap (`MAX_PAGE_SIZE`) — the largest list one read may return. */
const HOLDER_PAGE_SIZE = 100;

/** How many list pages of one portfolio are read at a time. */
const PAGE_BATCH = 5;

export interface HolderTransactionsOptions {
  type?: string;
  year?: string;
  q?: string;
  status?: "draft";
  /** Currency the rows are converted into (the scope's display currency). */
  convertTo?: string;
}

export interface HolderTransactionsView {
  status: "ok" | DataFailureStatus;
  /** Seconds to wait when `status` is `rate_limited` and the API said how long. */
  retryAfter?: number | null;
  rows: TransactionWithPortfolio[];
  total: number;
  years: string[];
}

/**
 * The transactions of one account holder's portfolios — a holder scope's Activity ledger.
 *
 * The API's aggregate `/networth/transactions` is user-scoped: it has no holder filter, so
 * a holder scope is composed here from the holder's own portfolios. Each portfolio's
 * filtered list is read page by page (the API caps one page at 100 rows) and the rows are
 * merged newest-first, tagged with the portfolio they belong to.
 *
 * The merged set is COMPLETE, not one page of it: the Activity table pages through the rows
 * it was handed and only asks the server for more once it has shown them all — a partial
 * set would send it back to the unscoped aggregate endpoint.
 */
export async function loadHolderTransactions(
  holderId: string,
  options: HolderTransactionsOptions = {},
): Promise<HolderTransactionsView> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized", rows: [], total: 0, years: [] };
  try {
    const portfolios = (await listPortfoliosCached()).filter((p) => p.accountHolderId === holderId);
    if (portfolios.length === 0) return { status: "ok", rows: [], total: 0, years: [] };
    const nameById = new Map(portfolios.map((p) => [p.id, p.name]));
    const perPortfolio = await Promise.all(
      portfolios.map((p) => loadPortfolioTransactionRows(api, p.id, options)),
    );
    const rows = perPortfolio
      .flat()
      .map((row) => ({ ...row, portfolioName: nameById.get(row.portfolioId) ?? "" }))
      .sort((a, b) => b.executedAt.localeCompare(a.executedAt));
    const years = [...new Set(rows.map((r) => r.executedAt.slice(0, 4)))].sort((a, b) =>
      b.localeCompare(a),
    );
    return { status: "ok", rows, total: rows.length, years };
  } catch (err) {
    const failure = classifyFailure(err);
    return {
      status: failure.status,
      ...(failure.status === "rate_limited" ? { retryAfter: failure.retryAfter } : {}),
      rows: [],
      total: 0,
      years: [],
    };
  }
}

/** Every row of one portfolio's filtered list, read page by page. */
async function loadPortfolioTransactionRows(
  api: ApiClient,
  portfolioId: string,
  options: HolderTransactionsOptions,
): Promise<Transaction[]> {
  const read = (page: number) =>
    api.listTransactionsPaginated(
      portfolioId,
      page,
      HOLDER_PAGE_SIZE,
      options.convertTo,
      options.type,
      options.year,
      options.q,
      undefined,
      undefined,
      options.status,
    );
  const first = await read(1);
  const rows = [...first.rows];
  const pages = Math.ceil((first.total ?? 0) / HOLDER_PAGE_SIZE);
  // The remaining pages in small batches — a long history must not fire 50 requests at once.
  for (let start = 2; start <= pages; start += PAGE_BATCH) {
    const batch: number[] = [];
    for (let p = start; p < start + PAGE_BATCH && p <= pages; p++) batch.push(p);
    const fetched = await Promise.all(batch.map(read));
    for (const page of fetched) rows.push(...page.rows);
  }
  return rows;
}

export interface HoldingsView {
  status: "ok" | "empty" | DataFailureStatus;
  /** Seconds to wait when `status` is `rate_limited` and the API said how long. */
  retryAfter?: number | null;
  holdings: HoldingValuation[];
  displayCurrency: string;
  /** Native cash balances by currency. */
  cash: Record<string, string>;
  /** `cash` converted into `displayCurrency`; a currency with no FX rate is absent. */
  cashDisplay: Record<string, string>;
  cashTracked: boolean;
  /** Currencies with no FX rate into `displayCurrency` (audit B2). */
  fxMissingCurrencies: string[];
}

export type PortfolioResult<T> =
  { status: "ok"; portfolio: Portfolio; data: T } | { status: "empty" } | DataFailure;

const ID_ALL_PORTFOLIOS_ID = "__id_all_portfolios__";

export interface TaxDisposalLot {
  acqDate: string;
  quantity: string;
  buyPrice: string;
  sellPrice: string;
  proceeds: string;
  gain: string;
  holdingDays: number;
  longTerm: boolean;
}

export interface TaxDisposalRow {
  symbol: string;
  when: string;
  instrumentId?: string | null;
  proceeds: string;
  gain: string;
  tfRate: string;
  gainAdjusted: string;
  quantity: string;
  avgBuyPrice: string;
  sellPrice: string;
  lots: TaxDisposalLot[];
}

export interface TaxDividendRow {
  /** Instrument symbol, else the transaction description, else the instrument id's first 8
   *  characters (an instrument without a loaded symbol), else the raw type (see `cashType`). */
  symbol: string;
  /** Set on cash income with neither an instrument nor a description, whose `symbol` is only
   *  the type key: the table shows a translated label instead. */
  cashType?: IdCashIncomeSource["type"];
  currency: string;
  gross: string;
  tax: string;
  net: string;
}

export interface TaxCurrencyTotal {
  currency: string;
  gross: string;
  tax: string;
  net: string;
}

export interface TaxYearRow {
  year: number;
  realized: string;
  dividends: string;
  tax: string;
  fsaUsed: string;
}

/** The API's Indonesian final-tax payload (`/portfolios/:id/tax`, `/networth/tax`). */
export type IndonesianFinalTaxLike = import("@portfolio/api-client").IndonesianFinalTax;

export interface TaxYearDetail {
  currency: string;
  /** Currencies with no FX rate in the payloads this detail was built from (audit B2). */
  fxMissingCurrencies?: string[];
  disposals: TaxDisposalRow[];
  totalProceeds: string;
  totalGain: string;
  dividendRows: TaxDividendRow[];
  dividendTotalsByCurrency: TaxCurrencyTotal[];
  byYear: TaxYearRow[];
  /**
   * Server-computed Indonesian final-tax breakdown for the same year. Only populated
   * when `userPreferences.taxRegime === "ID"`. The web tier treats this as the
   * source of truth — no client-side recomputation against `disposals` /
   * `dividendRows` (which serve the German branch).
   */
  indonesianFinalTax?: IndonesianFinalTaxLike;
}

/** Extended TaxSummaryHolder carrying the real account-holder id (nullable — the
 *  single-portfolio path falls back to a portfolio id in `holder.id` when the
 *  portfolio has no account holder configured, which the loss-carryforward editor
 *  must not be pointed at). */
export interface TaxSummaryHolderWithCarryForward extends TaxSummaryHolder {
  accountHolderId: string | null;
}

export interface InsightsView {
  status: "ok";
  data: InsightsResponse;
}

export interface InstrumentDetail {
  instrument: Instrument;
  history: Candle[];
  corporateActions: CorporateAction[];
}

export interface InstrumentScope {
  holding: HoldingValuation | null;
  aggregate: boolean;
  displayCurrency: string;
  totalMarketValueDisplay: number | null;
}

export async function loadHoldings(
  costBasis?: "purchase_price" | "total_paid",
  portfolioOverride?: string,
): Promise<HoldingsView> {
  const api = await getServerApi();
  if (!api)
    return {
      status: "unauthorized",
      holdings: [],
      displayCurrency: "IDR",
      cash: {},
      cashDisplay: {},
      cashTracked: false,
      fxMissingCurrencies: [],
    };
  try {
    const portfolios = await listPortfoliosCached();
    if (portfolios.length === 0) {
      return {
        status: "empty",
        holdings: [],
        displayCurrency: "IDR",
        cash: {},
        cashDisplay: {},
        cashTracked: false,
        fxMissingCurrencies: [],
      };
    }
    const overrideId =
      portfolioOverride && portfolios.some((p) => p.id === portfolioOverride)
        ? portfolioOverride
        : null;
    const wanted = overrideId ?? (await getSelectedPortfolioId());
    const selected = portfolios.find((p) => p.id === wanted);
    const holderId = selected ? undefined : await resolveHolderScope(portfolios);
    const resolvedCostBasis = normalizeCostBasis(costBasis);
    const data = selected
      ? await getSummaryCached(selected.id, resolvedCostBasis)
      : await getNetWorthCached(resolvedCostBasis, holderId, "max");
    return {
      status: "ok",
      holdings: data.holdings,
      displayCurrency: data.displayCurrency,
      cash: data.cash,
      // Defaulted like fxMissingCurrencies: response validation is off in production, so an
      // API that predates the field must degrade (rows flagged "No FX rate"), not throw.
      cashDisplay: data.cashDisplay ?? {},
      cashTracked: data.cashTracked,
      fxMissingCurrencies: data.fxMissingCurrencies ?? [],
    };
  } catch (err) {
    const failure = classifyFailure(err);
    return {
      status: failure.status,
      ...(failure.status === "rate_limited" ? { retryAfter: failure.retryAfter } : {}),
      holdings: [],
      displayCurrency: "IDR",
      cash: {},
      cashDisplay: {},
      cashTracked: false,
      fxMissingCurrencies: [],
    };
  }
}

export {
  getServerApi,
  normalizeCostBasis,
  listPortfoliosCached,
  listAccountHoldersCached,
  meCached,
  getSummaryCached,
  getPerformanceCached,
  getNetWorthCached,
  getRawScope,
  ID_ALL_PORTFOLIOS_ID,
  toApiRange,
};
export type { InstrumentPriceRange };
