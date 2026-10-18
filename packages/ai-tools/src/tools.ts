import {
  ApiError,
  apiErrorCode,
  MAX_PROPOSED_TRANSACTIONS,
  proposeTransactionsBodySchema,
} from "@portfolio/api-client";
import type {
  ApiClient,
  HoldingValuation,
  NetWorth,
  PortfolioSummary,
} from "@portfolio/api-client";
import { z } from "zod";
import { downsample } from "./compact.js";
import { stripSensitive } from "./redact.js";
import { regimeCaveat, TAX_CONCEPT_TEXT, TAX_CONCEPTS } from "./tax-concepts.js";
import type { AiTool } from "./types.js";

const costBasis = z.enum(["purchase_price", "total_paid"]).optional();
const range = z.enum(["1d", "7d", "1m", "3m", "6m", "ytd", "1y", "5y", "all"]).default("1y");
// Ids go into URL paths and query strings; a GUID check keeps `/`, `?` and `..` out of them.
const id = () => z.guid();
const portfolioId = id().describe("Portfolio id from list_portfolios");
const optionalPortfolioId = portfolioId
  .optional()
  .describe("Portfolio id from list_portfolios; omit for all portfolios combined");
const holderId = id()
  .optional()
  .describe("Account holder id; omit for everyone. Ignored when portfolioId is given.");

const BASIS_NOTE =
  "Name the basis of any gain you quote (vs cost of holdings / vs net contributed) and disclose " +
  "valuedAtCost holdings and fxMissingCurrencies exclusions.";

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  // Shared cursor: safe without a lock, as `next++` and the bounds check run synchronously
  // between awaits (JS is single-threaded), so no two workers can claim the same index.
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

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
    cashDisplay: s.cashDisplay,
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
 * A failed call becomes data the model can act on ("tax_allowance_not_configured"), never the
 * raw error: that carries the response body and a stack, which must not reach the provider.
 */
export function toolError(err: unknown) {
  if (err instanceof ApiError) {
    return { error: apiErrorCode(err) ?? "request_failed", status: err.status };
  }
  return { error: "tool_failed" };
}

/** True for the `{ error, status? }` shape `toolError` produces (transports flag it as an error). */
export function isToolError(out: unknown): boolean {
  if (!out || typeof out !== "object") return false;
  const keys = Object.keys(out);
  return (
    typeof (out as { error?: unknown }).error === "string" &&
    keys.every((k) => k === "error" || k === "status")
  );
}

export interface CreateToolsOptions {
  /**
   * Also offer the tools that write. They only ever create *draft* records for the user to
   * confirm. Pass true only for a write-scoped credential: a read-only one is refused by the
   * API anyway, but a tool it can never use shouldn't be offered.
   */
  write?: boolean;
}

/**
 * Build the tool set over an API client: read-only tools, plus (with `write`) the draft-only
 * ones. The client carries the caller's credentials, so every call is scoped to that user by
 * the API exactly like the web app's. Every handler's output is deep-stripped of sensitive
 * keys before it is returned.
 */
export function createTools(client: ApiClient, opts: CreateToolsOptions = {}): AiTool[] {
  const defs: AiTool[] = [];
  const add = <S extends z.ZodType>(t: AiTool<S>) => {
    defs.push({
      ...t,
      handler: async (input: unknown) => {
        try {
          return stripSensitive(await t.handler(input as z.infer<S>));
        } catch (err) {
          return toolError(err);
        }
      },
    } as AiTool);
  };

  add({
    name: "list_portfolios",
    title: "List portfolios",
    description:
      "List the user's portfolios (depots/accounts) with id, name, currency, brokerage, the country " +
      "the account is held in (ISO code, null when unset), holder and whether cash is inside the " +
      "investment boundary (cashCounted). Call this first to get ids.",
    inputSchema: z.object({}),
    handler: async () => {
      const list = await client.listPortfolios();
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        baseCurrency: p.baseCurrency,
        brokerage: p.brokerage,
        country: p.country,
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
      instrumentId: id().optional(),
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
      "loss pots and estimated tax. One portfolio, or all grouped by holder. Not tax advice. " +
      "Under the ID regime `indonesianFinalTax` taxes each income row at its own final rate (`income[].category`): " +
      "Indonesian dividends 10% (paid by the user, exempt if reinvested in Indonesia for 3 years), bond interest 10% and " +
      "bank interest 20% from a bank in Indonesia, in any currency (both withheld at source; cash interest follows the " +
      "portfolio's `country` from list_portfolios: ID is Indonesian, another country foreign, unset falls back to IDR = " +
      "Indonesian), " +
      "reksa dana/ETF distributions 0%. `taxWithheldAtSource` is already " +
      "withheld and `taxToSelfPay` is what the user pays; never present the whole `estimatedTax` as still owed. Foreign income " +
      "(`foreignIncomeGross`) is not in `estimatedTax`: it is taxed at the user's marginal rate (5–35%) with a credit for " +
      "`foreignTaxWithheld`, which Pocket cannot compute.",
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
      "currency, region, sector. Empty when the user has not set targets. Pass newCash to run a what-if: " +
      "a positive decimal string (dot as separator, no currency symbol) in the result's displayCurrency, e.g. " +
      "'1000'. The result then also has `trades`, a buy-only split of that cash over the buckets that are " +
      "under target, in proportion to their target weights (no selling; buckets within the tolerance band " +
      "get nothing). Describe those amounts as an illustration of the split, not as advice, and never " +
      "recompute them. Disclose fxMissingCurrencies exclusions.",
    inputSchema: z.object({
      portfolioId: optionalPortfolioId,
      dimension: z.enum(["asset_class", "currency", "region", "sector"]),
      newCash: z
        .string()
        .max(24)
        .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
        .refine((v) => /[1-9]/.test(v), "must be greater than zero")
        .optional()
        .describe(
          "Fresh cash to deploy, positive decimal string in the response's displayCurrency",
        ),
    }),
    handler: async ({ portfolioId: id, dimension, newCash }) => {
      if (newCash !== undefined) {
        const plan = await client.getRebalancingPlan(dimension, newCash, id);
        return {
          ...plan,
          fxMissingCurrencies: plan.fxMissingCurrencies ?? [],
          note:
            "Buy-only: newCash is split across under-target buckets in proportion to their target " +
            "weights. An illustration of the split, not advice.",
        };
      }
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

  add({
    name: "explain_tax_concept",
    title: "Explain a tax concept",
    description:
      "Plain-language, reviewed explanation of a German tax concept Pocket models: vorabpauschale, " +
      "teilfreistellung, basiszins, fsa, sparerpauschbetrag, loss_pots. Static text with no live rates and " +
      "none of the user's figures: for their own numbers (accrued or estimated Vorabpauschale, " +
      "Teilfreistellung rates per instrument, allowance used) call get_tax_summary. For a user on the " +
      "Indonesian regime the result carries a caveat that the concept does not apply to them; pass it on. " +
      "Not tax advice.",
    inputSchema: z.object({ concept: z.enum(TAX_CONCEPTS) }),
    handler: async ({ concept }) => {
      // A failed preferences lookup must not hide the explanation; the caveat then says "unknown".
      const regime = await client
        .getPreferences()
        .then((p) => p.taxRegime)
        .catch(() => null);
      const caveat = regimeCaveat(regime);
      return {
        concept,
        taxRegime: regime,
        ...TAX_CONCEPT_TEXT[concept],
        ...(caveat ? { caveat } : {}),
        disclaimer: "Explanation only, not tax advice.",
      };
    },
  });

  add({
    name: "get_fsa_allocation",
    title: "FSA allocation across depots",
    description:
      "How a holder's Freistellungsauftrag (FSA) is split across depots for a tax year: per depot the " +
      "allocated amount, the allowance used so far and what remains, plus the holder's cap, total " +
      "allocated and whether it is over-allocated. Use it to suggest, as an illustration, how the user " +
      "could re-split the allocation (e.g. move allowance from a depot with headroom to one that is " +
      "exhausted). It is advisory only: you cannot change anything. Tell the user to change a depot's tax " +
      "allowance in Settings and, separately, the FSA at the broker. Depots are identified by id and " +
      "brokerage; German regime only. Not tax advice.",
    inputSchema: z.object({
      holderId,
      year: z.number().int().min(2000).max(2100).optional(),
    }),
    handler: async ({ holderId: h, year }) => {
      // The regime comes from preferences, not from the depot loop: an Indonesian-regime user
      // whose depots carry no allowance would otherwise never see the note. A failed lookup
      // must not hide the allocation.
      const [all, regime] = await Promise.all([
        client.listPortfolios(),
        client
          .getPreferences()
          .then((pr) => pr.taxRegime)
          .catch(() => null),
      ]);
      const depots = all.filter((p) => !h || p.accountHolderId === h);
      const rows = await mapLimited(depots, 3, async (p) => {
        const base = {
          portfolioId: p.id,
          holderId: p.accountHolderId,
          brokerage: p.brokerage,
          allocated: p.taxAllowanceAnnual,
        };
        // No FSA allocated: the tax route would refuse (422) and there is nothing to split.
        if (p.taxAllowanceAnnual == null) {
          return {
            depot: { ...base, used: null, remaining: null },
            distribution: null,
            regime: null,
          };
        }
        try {
          const tax = await client.getPortfolioTax(p.id, year);
          return {
            depot: {
              ...base,
              used: tax.allowanceUsage?.usedYtd ?? null,
              remaining: tax.allowanceUsage?.remaining ?? null,
              currency: tax.currency,
            },
            distribution: tax.holderDistribution ?? null,
            regime: tax.regime ?? null,
            year: tax.year,
          };
        } catch (err) {
          const e = toolError(err);
          return {
            depot: { ...base, used: null, remaining: null, error: e.error },
            distribution: null,
            regime: null,
          };
        }
      });
      const holders = new Map<string, unknown>();
      for (const r of rows) {
        const hid = r.depot.holderId;
        if (hid && r.distribution && !holders.has(hid)) {
          // Pick the figures explicitly: a holder name must never ride along.
          const {
            currency,
            holderAllowanceCap,
            totalAllocated,
            remainingToDistribute,
            overAllocated,
          } = r.distribution;
          holders.set(hid, {
            // The cap/allocations are euro amounts, unlike the depot's own figures.
            currency: currency ?? "EUR",
            holderAllowanceCap,
            totalAllocated,
            remainingToDistribute,
            overAllocated,
          });
        }
      }
      return {
        year: rows.find((r) => "year" in r)?.year ?? year ?? null,
        depots: rows.map((r) => r.depot),
        holders: [...holders].map(([holderId, holderDistribution]) => ({
          holderId,
          holderDistribution,
        })),
        ...(regime === "ID" || rows.some((r) => r.regime === "ID")
          ? { note: "The Indonesian final-tax regime has no FSA; nothing to allocate." }
          : {}),
      };
    },
  });

  add({
    name: "resolve_instrument",
    title: "Resolve an unknown instrument",
    description:
      "Look an instrument up at the market-data providers by ticker, name or ISIN (including ISIN to " +
      "ticker resolution) when it is not yet in the user's data: returns symbol, isin, name, assetClass, " +
      "market and currency, up to 10 matches. Use lookup_instrument for instruments already known to " +
      "Pocket. Present candidates and let the user choose; never assume one when several match.",
    inputSchema: z.object({ q: z.string().min(1).max(100) }),
    handler: async ({ q }) => {
      const list = await client.lookupInstruments(q);
      return list.slice(0, 10).map((i) => ({
        symbol: i.symbol,
        isin: i.isin ?? null,
        name: i.name,
        assetClass: i.assetClass,
        market: i.market,
        currency: i.currency,
      }));
    },
  });

  add({
    name: "explain_import_duplicates",
    title: "Explain import duplicate flags",
    description:
      "For a draft import (id from the review link), list which drafts were flagged as likely duplicates " +
      "of already-booked transactions in the import's target portfolio, with the matching transaction's " +
      "source and date, and explain the flag. kind 'enrichment' = same trade from a different source and " +
      "this import adds a document or tax detail, so confirming enriches the existing transaction. kind " +
      "'duplicate' = same source or nothing new, so it is held back from 'Confirm all'. If the import " +
      "has no target portfolio yet, nothing was checked: the user picks one in the review screen. Nothing " +
      "is booked or changed.",
    inputSchema: z.object({ importId: id().describe("Import id from the review link") }),
    handler: async ({ importId }) => {
      const imp = await client.getImport(importId);
      const flagged = imp.drafts.flatMap((d, draftIndex) =>
        d.likelyDuplicate
          ? [
              {
                draftIndex,
                kind: d.likelyDuplicate.kind,
                draft: {
                  name: d.name ?? d.isin ?? d.ticker ?? null,
                  action: d.action,
                  quantity: d.quantity,
                  executedAt: String(d.executedAt).slice(0, 10),
                },
                matched: {
                  source: d.likelyDuplicate.source,
                  executedAt: String(d.likelyDuplicate.executedAt).slice(0, 10),
                },
              },
            ]
          : [],
      );
      return {
        importId: imp.id,
        status: imp.status,
        parser: imp.parser,
        draftCount: imp.drafts.length,
        checkedAgainstPortfolio: imp.portfolioId !== null,
        flagged,
        explanation:
          "Pocket dedups in three levels: the same file is recognised by its content hash; within one " +
          "source a transaction is unique by its external id; and across sources an economic fingerprint " +
          "(instrument, type, day, quantity, price) flags likely re-imports, counting same-day repeats so " +
          "genuine ones are not suppressed. Imports never auto-commit: the user always reviews and confirms.",
      };
    },
  });

  if (opts.write) {
    add({
      name: "propose_transactions",
      title: "Propose transactions (draft)",
      readOnly: false,
      description:
        "Create a DRAFT import from transactions you extracted from text the user gave you (e.g. a pasted " +
        "broker email or contract note). Nothing is booked: the user must open the review link and confirm " +
        "it, and Pocket flags likely duplicates of transactions already recorded. " +
        "Only include trades you can read in the text — never guess a price, quantity or date; ask the user " +
        "instead. Dates are ISO 8601, amounts are decimal strings (dot as separator), currency is an ISO " +
        "code. Give each security a ticker, isin, wkn or name. Pass portfolioId (from list_portfolios) when " +
        `the user said which depot; at most ${MAX_PROPOSED_TRANSACTIONS} transactions per call. ` +
        "Afterwards tell the user the draft is waiting for their confirmation and give them the review link " +
        "(reviewUrl if present, else reviewPath) as a Markdown link.",
      inputSchema: proposeTransactionsBodySchema,
      handler: async (input) => {
        const res = await client.proposeTransactions(input);
        return {
          ...res,
          note: res.alreadyExists
            ? "This exact proposal was already waiting for review."
            : res.alreadyConfirmed
              ? "This exact proposal was already confirmed earlier."
              : "Draft created. The user still has to review and confirm it.",
        };
      },
    });
  }

  return defs;
}
