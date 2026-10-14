import type {
  ApiClient,
  HoldingValuation,
  NetWorth,
  PortfolioSummary,
} from "@portfolio/api-client";
import { z } from "zod";
import { downsample } from "./compact.js";
import { stripSensitive } from "./redact.js";
import type { AiTool } from "./types.js";

const costBasis = z.enum(["purchase_price", "total_paid"]).optional();
const range = z.enum(["1d", "7d", "1m", "3m", "6m", "ytd", "1y", "5y", "all"]).default("1y");
const portfolioId = z.string().min(1).describe("Portfolio id from list_portfolios");
const optionalPortfolioId = portfolioId
  .optional()
  .describe("Portfolio id from list_portfolios; omit for all portfolios combined");
const holderId = z
  .string()
  .optional()
  .describe("Account holder id; omit for everyone. Ignored when portfolioId is given.");

const BASIS_NOTE =
  "Name the basis of any gain you quote (vs cost of holdings / vs net contributed) and disclose " +
  "valuedAtCost holdings and fxMissingCurrencies exclusions.";

/** Per-holding fields a model needs; drops lots/sparkline and nested metadata noise. */
function compactHolding(h: HoldingValuation) {
  return {
    instrumentId: h.instrumentId,
    symbol: h.instrument?.symbol ?? null,
    name: h.instrument?.displayName ?? h.instrument?.name ?? null,
    assetClass: h.instrument?.assetClass ?? null,
    quantity: h.quantity,
    avgCost: h.avgCost,
    costBasis: h.costBasis,
    costCurrency: h.costCurrency,
    price: h.price,
    currency: h.currency,
    marketValueDisplay: h.marketValueDisplay,
    costBasisDisplay: h.costBasisDisplay,
    unrealizedPnLDisplay: h.unrealizedPnLDisplay,
    dayChangePct: h.dayChangePct,
    valuedAtCost: h.valuedAtCost ?? false,
    fxMissing: h.fxMissing ?? false,
  };
}

/** Headline of a summary/net-worth response: totals + gain + allocation, no holdings array. */
function compactHeadline(s: PortfolioSummary | NetWorth) {
  return {
    displayCurrency: s.displayCurrency,
    netWorth: s.netWorth,
    totalCost: s.totalCost,
    totalMarketValue: s.totalMarketValue,
    totalUnrealizedPnL: s.totalUnrealizedPnL,
    totalRealizedPnL: s.totalRealizedPnL,
    totalIncome: s.totalIncome,
    totalLiabilities: s.totalLiabilities,
    totalDayChange: s.totalDayChange,
    cashTracked: s.cashTracked,
    cash: s.cash,
    exposureByCurrency: s.exposureByCurrency,
    fxMissingCurrencies: s.fxMissingCurrencies ?? [],
    holdingCount: s.holdings.length,
    valuedAtCostCount: s.holdings.filter((h) => h.valuedAtCost).length,
    gain: s.gain ?? null,
    allocation: s.allocation ?? null,
    drift: s.drift ?? null,
  };
}

/**
 * Build the read-only tool set over an API client. The client carries the caller's
 * credentials, so every call is scoped to that user by the API exactly like the web app's.
 * Every handler's output is deep-stripped of sensitive keys before it is returned.
 */
export function createTools(client: ApiClient): AiTool[] {
  const defs: AiTool[] = [];
  const add = <S extends z.ZodType>(t: AiTool<S>) => {
    defs.push({
      ...t,
      handler: async (input: unknown) => stripSensitive(await t.handler(input as z.infer<S>)),
    } as AiTool);
  };

  add({
    name: "list_portfolios",
    title: "List portfolios",
    description:
      "List the user's portfolios (depots/accounts) with id, name, currency, brokerage, holder and " +
      "whether cash is inside the investment boundary (cashCounted). Call this first to get ids.",
    inputSchema: z.object({}),
    handler: async () => {
      const list = await client.listPortfolios();
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        baseCurrency: p.baseCurrency,
        brokerage: p.brokerage,
        accountHolderId: p.accountHolderId,
        portfolioType: p.portfolioType,
        cashCounted: p.cashCounted,
      }));
    },
  });

  add({
    name: "get_net_worth",
    title: "Net worth",
    description:
      "Total net worth across all portfolios: value, cost, unrealized/realized/income, the gain " +
      "breakdown with its bases, allocation and drift vs targets, XIRR, and period P&L. " +
      "Holdings are not included — use get_holdings. " +
      BASIS_NOTE,
    inputSchema: z.object({
      holderId,
      period: z.enum(["ytd", "1y", "5y", "max"]).optional(),
      costBasis,
    }),
    handler: async ({ holderId: h, period, costBasis: cb }) => {
      const nw = await client.getNetWorth(cb, h, period);
      return {
        ...compactHeadline(nw),
        xirr: nw.xirr,
        period: nw.period ?? "max",
        periodXirr: nw.periodXirr ?? null,
        periodPnL: nw.periodPnL ?? null,
        periodPnLPct: nw.periodPnLPct ?? null,
        portfolioCount: nw.portfolioCount,
        asOf: nw.asOf,
      };
    },
  });

  add({
    name: "get_portfolio_summary",
    title: "Portfolio summary",
    description:
      "Summary of one portfolio: totals, gain breakdown with bases, allocation, drift, XIRR. " +
      "Holdings are not included — use get_holdings. " +
      BASIS_NOTE,
    inputSchema: z.object({ portfolioId, costBasis }),
    handler: async ({ portfolioId: id, costBasis: cb }) => {
      const [summary, perf] = await Promise.all([
        client.getSummary(id, cb),
        client.getPerformance(id),
      ]);
      return { ...compactHeadline(summary), xirr: perf.xirr, asOf: perf.asOf };
    },
  });

  add({
    name: "get_holdings",
    title: "Holdings",
    description:
      "Current holdings with quantity, average cost, cost basis, price, market value and unrealized " +
      "P&L in the display currency. valuedAtCost=true means no usable price: valued at cost, no " +
      "measured gain. fxMissing=true means excluded from totals (no FX rate).",
    inputSchema: z.object({
      portfolioId: optionalPortfolioId,
      holderId,
      costBasis,
      limit: z.number().int().min(1).max(200).default(100),
    }),
    handler: async ({ portfolioId: id, holderId: h, costBasis: cb, limit }) => {
      const src = id ? await client.getSummary(id, cb) : await client.getNetWorth(cb, h);
      const sorted = [...src.holdings].sort(
        (a, b) => Number(b.marketValueDisplay ?? 0) - Number(a.marketValueDisplay ?? 0),
      );
      return {
        displayCurrency: src.displayCurrency,
        total: sorted.length,
        truncated: sorted.length > limit,
        holdings: sorted.slice(0, limit).map(compactHolding),
        fxMissingCurrencies: src.fxMissingCurrencies ?? [],
      };
    },
  });

  add({
    name: "search_transactions",
    title: "Search transactions",
    description:
      "Search transactions (buys, sells, dividends, deposits, transfers …) newest first, with paging. " +
      "Filter by type, calendar year, free text (description/tags) or instrumentId. Drafts are excluded. Free-text memos are never returned, but `q` still matches them.",
    inputSchema: z.object({
      portfolioId: optionalPortfolioId,
      type: z.string().optional().describe("e.g. buy, sell, dividend, deposit, transfer_in"),
      year: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
      q: z.string().optional(),
      instrumentId: z.string().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(50).default(25),
    }),
    handler: async ({ portfolioId: id, type, year, q, instrumentId, page, pageSize }) => {
      const res = id
        ? await client.listTransactionsPaginated(
            id,
            page,
            pageSize,
            undefined,
            type,
            year,
            q,
            instrumentId,
          )
        : await client.listNetworthTransactionsPaginated(
            page,
            pageSize,
            type,
            year,
            q,
            instrumentId,
          );
      return {
        total: res.total,
        page,
        pageSize,
        summary: res.summary ?? null,
        rows: res.rows.map((t) => ({
          id: t.id,
          portfolioId: t.portfolioId,
          instrumentId: t.instrumentId,
          type: t.type,
          quantity: t.quantity,
          price: t.price,
          fees: t.fees,
          currency: t.currency,
          fxMissing: t.fxMissing ?? false,
          executedAt: t.executedAt,
        })),
      };
    },
  });

  add({
    name: "get_performance",
    title: "Value history",
    description:
      "Net-worth history over a range as a downsampled series (≤60 points) plus the point count.",
    inputSchema: z.object({ portfolioId: optionalPortfolioId, range, holderId }),
    handler: async ({ portfolioId: id, range: r, holderId: h }) => {
      const series = id
        ? await client.getPortfolioHistory(id, r)
        : await client.getNetWorthHistory(r, { holderId: h });
      const { points, total } = downsample(series);
      return { range: r, totalPoints: total, points };
    },
  });

  add({
    name: "get_income",
    title: "Income",
    description:
      "Dividend, coupon and interest income statistics, including the forecast for the rest of the year. " +
      "Income is return, never contribution.",
    inputSchema: z.object({ portfolioId: optionalPortfolioId, holderId }),
    handler: ({ portfolioId: id, holderId: h }) =>
      id ? client.getPortfolioIncome(id) : client.getIncome(h),
  });

  add({
    name: "get_contributions",
    title: "Contributions",
    description:
      "Net contributed capital on each portfolio's own boundary (deposits−withdrawals for cash-inside, " +
      "net invested capital for cash-outside), the basis for 'vs net contributed' gains.",
    inputSchema: z.object({ portfolioId: optionalPortfolioId, holderId }),
    handler: ({ portfolioId: id, holderId: h }) =>
      id ? client.getPortfolioContributions(id) : client.getContributions(h),
  });

  add({
    name: "get_tax_summary",
    title: "Tax summary",
    description:
      "Tax summary for a tax year (German regime: Sparerpauschbetrag/FSA; Indonesian final tax under the ID regime). Fails if a depot has no FSA allocation configured. Covers realized gains, Freistellungsauftrag (FSA) usage and headroom, " +
      "loss pots and estimated tax. One portfolio, or all grouped by holder. Not tax advice.",
    inputSchema: z.object({
      portfolioId: optionalPortfolioId,
      year: z.number().int().min(2000).max(2100).optional(),
      holderId,
    }),
    handler: async ({ portfolioId: id, year, holderId: h }) => {
      if (id) return client.getPortfolioTax(id, year);
      // Holder names are personal data: keep the id and the tax parameters only.
      const holders = await client.getNetworthTax(year, h);
      return holders.map(({ holder, ...rest }) => ({
        ...rest,
        holder: {
          id: holder.id,
          taxAllowanceAnnual: holder.taxAllowanceAnnual,
          capitalGainsTaxRate: holder.capitalGainsTaxRate,
          churchTax: holder.churchTax,
          taxResidence: holder.taxResidence,
        },
      }));
    },
  });

  add({
    name: "get_rebalancing",
    title: "Targets and drift",
    description:
      "Saved target weights for a dimension and the current drift from them. Dimensions: asset_class, " +
      "currency, region, sector. Empty when the user has not set targets.",
    inputSchema: z.object({
      portfolioId: optionalPortfolioId,
      dimension: z.enum(["asset_class", "currency", "region", "sector"]),
    }),
    handler: async ({ portfolioId: id, dimension }) => {
      const [targets, src] = await Promise.all([
        id ? client.getPortfolioTargets(id, dimension) : client.getNetworthTargets(dimension),
        id ? client.getSummary(id) : client.getNetWorth(),
      ]);
      return { dimension, targets, drift: src.drift?.[dimension] ?? [] };
    },
  });

  add({
    name: "get_insights",
    title: "Risk and behaviour insights",
    description:
      "Drawdown, volatility, streaks, benchmark comparison, concentration trend and best/worst movers.",
    inputSchema: z.object({
      range: z.enum(["1m", "3m", "6m", "ytd", "1y", "5y", "all"]).default("all"),
      portfolioId: optionalPortfolioId,
      holderId,
    }),
    handler: ({ range: r, portfolioId: id, holderId: h }) =>
      client.getInsights(r, { portfolioId: id, holderId: h }),
  });

  add({
    name: "lookup_instrument",
    title: "Find instrument",
    description:
      "Find instruments by name, symbol, ISIN or WKN. Returns ids usable as instrumentId filters.",
    inputSchema: z.object({ q: z.string().min(1) }),
    handler: async ({ q }) => {
      const list = await client.searchInstruments(q);
      return list.slice(0, 20).map((i) => ({
        id: i.id,
        symbol: i.symbol,
        isin: i.isin,
        name: i.displayName ?? i.name,
        assetClass: i.assetClass,
        market: i.market,
        currency: i.currency,
      }));
    },
  });

  return defs;
}
