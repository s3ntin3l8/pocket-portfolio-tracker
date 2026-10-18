import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted shared state: set the auth env *before* server-api.ts is imported (its
// `authConfigured` is a module-level constant), and expose mutable session/cookie/client
// hooks the mocks below read on each call.
const h = vi.hoisted(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.AUTHENTIK_ISSUER = "https://auth.test/o/p/";
  return {
    // The resolved access token (or null when signed out) — server-api.ts reads this via
    // the mocked accessTokenFromCookieHeader below, mirroring how it reads the real
    // session cookie server-side rather than an Auth.js `Session` object.
    accessToken: null as string | null,
    cookies: {} as Record<string, string>,
    // `never[]` params so any concretely-typed stub (e.g. `(id: string) => …`) assigns.
    client: {} as Record<string, (...args: never[]) => unknown>,
    requestHeaders: {} as Record<string, string>,
    clientConfig: undefined as { headers?: Record<string, string> } | undefined,
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers(h.requestHeaders),
  cookies: async () => ({
    get: (name: string) => (h.cookies[name] !== undefined ? { value: h.cookies[name] } : undefined),
    getAll: () => Object.entries(h.cookies).map(([name, value]) => ({ name, value })),
  }),
}));
vi.mock("@/lib/session-token", () => ({
  accessTokenFromCookieHeader: async () => h.accessToken,
}));
vi.mock("@portfolio/api-client", () => ({
  createApiClient: (config: { headers?: Record<string, string> }) => {
    h.clientConfig = config;
    return h.client;
  },
}));

import * as api from "../src/lib/server-api";
import type { TaxSummaryHolder } from "@portfolio/api-client";

const PF = [
  { id: "p1", name: "Main", baseCurrency: "IDR" },
  { id: "p2", name: "DKB", baseCurrency: "EUR" },
];

beforeEach(() => {
  h.accessToken = "tok"; // signed in by default
  h.cookies = {};
  h.requestHeaders = {};
  h.clientConfig = undefined;
  h.client = {
    // resolveSelection() now always calls listAccountHolders — default to empty list.
    listAccountHolders: async () => [],
  };
});

describe("getSelectedPortfolioId", () => {
  it("returns the cookie's uuid, or null for 'all'/absent/holder scope", async () => {
    h.cookies = { pf: "p2" };
    expect(await api.getSelectedPortfolioId()).toBe("p2");
    h.cookies = { pf: "all" };
    expect(await api.getSelectedPortfolioId()).toBeNull();
    h.cookies = {};
    expect(await api.getSelectedPortfolioId()).toBeNull();
    // Holder scope also returns null (it's not a portfolio selection).
    h.cookies = { pf: "holder:h1" };
    expect(await api.getSelectedPortfolioId()).toBeNull();
  });
});

describe("scope precedence (?scope= header > pf cookie > all)", () => {
  it("prefers the proxy-provided ?scope= header over the cookie", async () => {
    h.cookies = { pf: "p1" };
    h.requestHeaders = { "x-pocket-scope": "p:p2" };
    expect(await api.getSelectedPortfolioId()).toBe("p2");
    h.requestHeaders = { "x-pocket-scope": "all" };
    expect(await api.getSelectedPortfolioId()).toBeNull();
  });

  it("ignores a malformed header and falls back to the cookie", async () => {
    h.cookies = { pf: "p1" };
    h.requestHeaders = { "x-pocket-scope": "nonsense" };
    expect(await api.getSelectedPortfolioId()).toBe("p1");
  });

  it("resolves a holder scope from the header for the layout selection", async () => {
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "h1" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "h1" },
    ];
    h.client.listAccountHolders = async () => [{ id: "h1", name: "Self" }];
    h.requestHeaders = { "x-pocket-scope": "h:h1" };
    expect(await api.resolveSelection()).toMatchObject({
      selectedId: null,
      selectedHolderId: "h1",
    });
  });
});

describe("resolveSelection", () => {
  it("validates the cookie against the live list", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p2" };
    expect(await api.resolveSelection()).toMatchObject({
      status: "ok",
      selectedId: "p2",
      selectedHolderId: null,
    });
  });

  it("collapses an unknown/stale id to the aggregate", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "ghost" };
    const res = await api.resolveSelection();
    expect(res.selectedId).toBeNull();
    expect(res.portfolios).toHaveLength(2);
  });

  it("resolves a holder scope and validates against qualifying holders (≥2 portfolios)", async () => {
    // p1 and p2 both belong to holder h1 → h1 qualifies (≥2 portfolios).
    const pfWithHolders = [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "h1" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "h1" },
    ];
    h.client.listPortfolios = async () => pfWithHolders;
    h.client.listAccountHolders = async () => [{ id: "h1", name: "Self" }];
    h.cookies = { pf: "holder:h1" };
    const res = await api.resolveSelection();
    expect(res.selectedId).toBeNull();
    expect(res.selectedHolderId).toBe("h1");
  });

  it("collapses a stale holder cookie to aggregate when holder no longer qualifies", async () => {
    // Only one portfolio for h2 → h2 doesn't qualify (< 2 portfolios).
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "h2" },
    ];
    h.client.listAccountHolders = async () => [{ id: "h2", name: "Child" }];
    h.cookies = { pf: "holder:h2" };
    const res = await api.resolveSelection();
    expect(res.selectedId).toBeNull();
    expect(res.selectedHolderId).toBeNull();
  });

  it("reports unavailable when not signed in", async () => {
    h.accessToken = null;
    expect(await api.resolveSelection()).toMatchObject({
      status: "unavailable",
      selectedId: null,
      selectedHolderId: null,
    });
  });
});

describe("loadTransactionsAcrossPortfolios (holder scope)", () => {
  it("still finds a row outside the active holder (id lookup is not scope-narrowed)", async () => {
    const pfWithHolders = [
      { id: "p1", name: "Self-A", baseCurrency: "IDR", accountHolderId: "h1" },
      { id: "p2", name: "Self-B", baseCurrency: "EUR", accountHolderId: "h1" },
      { id: "p3", name: "Other", baseCurrency: "IDR", accountHolderId: "h2" },
    ];
    h.client.listPortfolios = async () => pfWithHolders;
    const listTransactionsByIds = vi.fn(async (id: string, ids: string[]) =>
      id === "p3" && ids.includes("t3") ? [{ id: "t3", portfolioId: "p3", type: "buy" }] : [],
    );
    h.client.listTransactionsByIds = listTransactionsByIds;
    h.cookies = { pf: "holder:h1" };

    const res = await api.loadTransactionsAcrossPortfolios("t3");
    expect(res.status).toBe("ok");
    // The edit page is addressed by a concrete id, so a holder scope must not 404 it.
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0]?.portfolioName).toBe("Other");
    expect(listTransactionsByIds.mock.calls.map((c) => c[0]).sort()).toEqual(["p1", "p2", "p3"]);
  });
});

describe("loadHoldings", () => {
  it("uses the networth aggregate when no portfolio is selected", async () => {
    h.client.listPortfolios = async () => PF;
    const getNetWorth = vi.fn(async () => ({
      holdings: [{ instrumentId: "i1", quantity: "1" }],
      displayCurrency: "IDR",
    }));
    h.client.getNetWorth = getNetWorth;
    h.client.getSummary = vi.fn();

    const res = await api.loadHoldings();
    expect(res).toMatchObject({ status: "ok", displayCurrency: "IDR" });
    expect(res.holdings).toHaveLength(1);
    expect(getNetWorth).toHaveBeenCalled();
    expect(h.client.getSummary).not.toHaveBeenCalled();
  });

  it("uses the per-portfolio summary when one is selected", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p2" };
    const getSummary = vi.fn(async (id: string) => ({
      holdings: [{ instrumentId: "x", quantity: "2" }],
      displayCurrency: "EUR",
      _id: id,
    }));
    h.client.getSummary = getSummary;
    h.client.getNetWorth = vi.fn();

    const res = await api.loadHoldings();
    expect(res).toMatchObject({ status: "ok", displayCurrency: "EUR" });
    expect(getSummary).toHaveBeenCalledWith("p2", "purchase_price");
    expect(h.client.getNetWorth).not.toHaveBeenCalled();
  });

  it("forwards the first x-forwarded-for hop of the incoming request to the API client", async () => {
    h.requestHeaders = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };
    h.client.listPortfolios = async () => [];
    await api.loadHoldings();
    expect(h.clientConfig?.headers).toEqual({ "x-forwarded-for": "203.0.113.7" });
  });

  it("sends no forwarding header when the request has none", async () => {
    h.client.listPortfolios = async () => [];
    await api.loadHoldings();
    expect(h.clientConfig?.headers).toBeUndefined();
  });

  it("is empty with no portfolios and unavailable on error / signed out", async () => {
    h.client.listPortfolios = async () => [];
    expect(await api.loadHoldings()).toMatchObject({ status: "empty" });

    h.client.listPortfolios = async () => {
      throw new Error("boom");
    };
    expect(await api.loadHoldings()).toMatchObject({ status: "unavailable" });

    h.accessToken = null;
    expect(await api.loadHoldings()).toMatchObject({ status: "unauthorized" });
  });

  it("classifies 429 (with retryAfter) and 401 apart from a generic outage", async () => {
    h.client.listPortfolios = async () => {
      throw Object.assign(new Error("rl"), { status: 429, retryAfter: 16 });
    };
    expect(await api.loadHoldings()).toMatchObject({ status: "rate_limited", retryAfter: 16 });

    h.client.listPortfolios = async () => {
      throw Object.assign(new Error("rl"), { status: 429, retryAfter: null });
    };
    expect(await api.loadHoldings()).toMatchObject({ status: "rate_limited", retryAfter: null });

    h.client.listPortfolios = async () => {
      throw Object.assign(new Error("expired"), { status: 401 });
    };
    expect(await api.loadHoldings()).toMatchObject({ status: "unauthorized" });

    h.client.listPortfolios = async () => {
      throw Object.assign(new Error("down"), { status: 503 });
    };
    expect(await api.loadHoldings()).toMatchObject({ status: "unavailable" });
  });

  it("uses portfolioOverride instead of the cookie when the override is valid", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" }; // cookie says p1
    const getSummary = vi.fn(async () => ({
      holdings: [],
      displayCurrency: "EUR",
      cash: {},
      cashTracked: false,
    }));
    h.client.getSummary = getSummary;
    h.client.getNetWorth = vi.fn();

    const res = await api.loadHoldings(undefined, "p2"); // override says p2
    expect(res).toMatchObject({ status: "ok", displayCurrency: "EUR" });
    expect(getSummary).toHaveBeenCalledWith("p2", "purchase_price");
    expect(h.client.getNetWorth).not.toHaveBeenCalled();
  });

  it("passes cashDisplay and fxMissingCurrencies through, defaulting them when absent", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    h.client.getSummary = vi.fn(async () => ({
      holdings: [],
      displayCurrency: "IDR",
      cash: { EUR: "10" },
      cashDisplay: { EUR: "170000" },
      cashTracked: true,
      fxMissingCurrencies: ["USD"],
    }));
    const withFields = await api.loadHoldings();
    expect(withFields.cashDisplay).toEqual({ EUR: "170000" });
    expect(withFields.fxMissingCurrencies).toEqual(["USD"]);

    // An API that predates the fields (validation is off in production) must not leave
    // them undefined behind a non-optional type — the page indexes cashDisplay directly.
    h.client.getSummary = vi.fn(async () => ({
      holdings: [],
      displayCurrency: "IDR",
      cash: { EUR: "10" },
      cashTracked: true,
    }));
    const legacy = await api.loadHoldings(undefined, "p2");
    expect(legacy.cashDisplay).toEqual({});
    expect(legacy.fxMissingCurrencies).toEqual([]);
  });

  it("falls back to the cookie when portfolioOverride is stale/unknown", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    const getSummary = vi.fn(async () => ({
      holdings: [],
      displayCurrency: "IDR",
      cash: {},
      cashTracked: false,
    }));
    h.client.getSummary = getSummary;

    await api.loadHoldings(undefined, "ghost"); // stale override
    expect(getSummary).toHaveBeenCalledWith("p1", "purchase_price"); // falls back to cookie
  });
});

describe("loadAnomalies", () => {
  it("returns null when no portfolio is selected (aggregate scope)", async () => {
    h.cookies = {};
    expect(await api.loadAnomalies()).toBeNull();
  });

  it("fetches anomalies for the selected portfolio", async () => {
    h.cookies = { pf: "p1" };
    h.client.getAnomalies = async () => ({
      anomalies: [{ id: "a1", severity: "warning", message: "test" }],
    });
    const res = await api.loadAnomalies();
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(1);
  });

  it("uses portfolioOverride instead of the cookie for anomalies", async () => {
    h.cookies = { pf: "p1" }; // cookie says p1
    const getAnomalies = vi.fn(async () => ({ anomalies: [] }));
    h.client.getAnomalies = getAnomalies;

    await api.loadAnomalies("p2"); // override says p2
    expect(getAnomalies).toHaveBeenCalledWith("p2");
  });

  it("returns null on error", async () => {
    h.cookies = { pf: "p1" };
    h.client.getAnomalies = async () => {
      throw new Error("x");
    };
    expect(await api.loadAnomalies()).toBeNull();
  });
});

describe("loadNetworthAnomalies", () => {
  it("fetches merged anomalies across all portfolios", async () => {
    const getNetworthAnomalies = vi.fn(async () => ({
      anomalies: [{ id: "a1", severity: "warning", message: "test" }],
    }));
    h.client.getNetworthAnomalies = getNetworthAnomalies;

    const res = await api.loadNetworthAnomalies();
    expect(getNetworthAnomalies).toHaveBeenCalledWith();
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(1);
  });

  it("returns null on error", async () => {
    h.client.getNetworthAnomalies = async () => {
      throw new Error("x");
    };
    expect(await api.loadNetworthAnomalies()).toBeNull();
  });

  it("returns null when not signed in", async () => {
    h.accessToken = null;
    expect(await api.loadNetworthAnomalies()).toBeNull();
  });
});

describe("loadTransactionsAcrossPortfolios", () => {
  it("looks the id up in every portfolio by id (never the full list) and tags the portfolio name", async () => {
    h.client.listPortfolios = async () => PF;
    const listTransactionsByIds = vi.fn(async (id: string, ids: string[]) =>
      id === "p2" && ids.includes("t2") ? [{ id: "t2", portfolioId: "p2", type: "sell" }] : [],
    );
    h.client.listTransactionsByIds = listTransactionsByIds;
    const listTransactions = vi.fn();
    h.client.listTransactions = listTransactions;

    const res = await api.loadTransactionsAcrossPortfolios("t2");
    expect(res.status).toBe("ok");
    expect(res.transactions).toHaveLength(1);
    expect(res.transactions[0]?.portfolioName).toBe("DKB");
    expect(listTransactionsByIds).toHaveBeenCalledWith("p1", ["t2"], "IDR");
    expect(listTransactionsByIds).toHaveBeenCalledWith("p2", ["t2"], "IDR");
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it("is empty with no portfolios and unavailable on error", async () => {
    h.client.listPortfolios = async () => [];
    expect(await api.loadTransactionsAcrossPortfolios("t1")).toMatchObject({
      status: "empty",
    });

    h.client.listPortfolios = async () => {
      throw new Error("x");
    };
    expect(await api.loadTransactionsAcrossPortfolios("t1")).toMatchObject({
      status: "unavailable",
    });
  });
});

describe("loadPortfolio", () => {
  it("honors the selected portfolio, else falls back to the first", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p2" };
    const selected = await api.loadPortfolio(async (_c, p) => p.id);
    expect(selected).toMatchObject({ status: "ok", data: "p2" });

    h.cookies = { pf: "ghost" }; // unknown → first
    const fallback = await api.loadPortfolio(async (_c, p) => p.id);
    expect(fallback).toMatchObject({ status: "ok", data: "p1" });
  });

  it("is empty with no portfolios and unauthorized when signed out", async () => {
    h.client.listPortfolios = async () => [];
    expect(await api.loadPortfolio(async () => 1)).toMatchObject({
      status: "empty",
    });
    h.accessToken = null;
    expect(await api.loadPortfolio(async () => 1)).toMatchObject({
      status: "unauthorized",
    });
  });
});

describe("aggregate + misc loaders", () => {
  it("loadNetWorth folds ok / empty / unavailable", async () => {
    h.client.listPortfolios = async () => PF;
    h.client.getNetWorth = async () => ({ portfolioCount: 2, netWorth: "100" });
    expect(await api.loadNetWorth()).toMatchObject({ status: "ok" });

    h.client.listPortfolios = async () => [];
    expect(await api.loadNetWorth()).toMatchObject({ status: "empty" });

    h.client.listPortfolios = async () => {
      throw new Error("x");
    };
    expect(await api.loadNetWorth()).toMatchObject({ status: "unavailable" });
  });

  it("loadNetWorth uses the aggregate when no portfolio is selected", async () => {
    h.client.listPortfolios = async () => PF;
    const getNetWorth = vi.fn(async () => ({ portfolioCount: 2, netWorth: "200", xirr: 0.05 }));
    h.client.getNetWorth = getNetWorth;
    h.client.getSummary = vi.fn();
    h.client.getPerformance = vi.fn();

    const res = await api.loadNetWorth();
    expect(res.status).toBe("ok");
    expect(getNetWorth).toHaveBeenCalled();
    expect(h.client.getSummary).not.toHaveBeenCalled();
    expect(h.client.getPerformance).not.toHaveBeenCalled();
  });

  it("loadNetWorth uses getSummary+getPerformance when a portfolio is selected", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p2" };
    const getSummary = vi.fn(async () => ({
      holdings: [],
      displayCurrency: "EUR",
      netWorth: "500",
      totalCost: "400",
      totalMarketValue: "500",
      totalUnrealizedPnL: "100",
      totalRealizedPnL: "0",
      totalIncome: "10",
      totalDayChange: "5",
      cash: {},
      exposureByCurrency: {},
    }));
    const getPerformance = vi.fn(async () => ({ xirr: 0.12, netWorth: "500", asOf: "2026-01-01" }));
    h.client.getSummary = getSummary;
    h.client.getPerformance = getPerformance;
    h.client.getNetWorth = vi.fn();

    const res = await api.loadNetWorth();
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.data.xirr).toBe(0.12);
      expect(res.data.portfolioCount).toBe(1);
      expect(res.data.asOf).toBe("2026-01-01");
    }
    expect(getSummary).toHaveBeenCalledWith("p2", "purchase_price");
    expect(getPerformance).toHaveBeenCalledWith("p2");
    expect(h.client.getNetWorth).not.toHaveBeenCalled();
  });

  it("loadNetWorthHistory uses the aggregate when no portfolio is selected", async () => {
    h.client.listPortfolios = async () => PF;
    const getNetWorthHistory = vi.fn(async (range: string) => [
      { date: "2026-01-01", netWorth: range },
    ]);
    h.client.getNetWorthHistory = getNetWorthHistory;
    h.client.getPortfolioHistory = vi.fn();

    expect(await api.loadNetWorthHistory("3m")).toEqual([{ date: "2026-01-01", netWorth: "3m" }]);
    expect(getNetWorthHistory).toHaveBeenCalledWith("3m", undefined);
    expect(h.client.getPortfolioHistory).not.toHaveBeenCalled();
  });

  it("loadNetWorthHistory uses getPortfolioHistory when a portfolio is selected", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p2" };
    const getPortfolioHistory = vi.fn(async (id: string, range: string) => [
      { date: "2026-01-01", netWorth: `${id}/${range}` },
    ]);
    h.client.getPortfolioHistory = getPortfolioHistory;
    h.client.getNetWorthHistory = vi.fn();

    expect(await api.loadNetWorthHistory("1m")).toEqual([
      { date: "2026-01-01", netWorth: "p2/1m" },
    ]);
    expect(getPortfolioHistory).toHaveBeenCalledWith("p2", "1m");
    expect(h.client.getNetWorthHistory).not.toHaveBeenCalled();
  });

  it("loadNetWorthHistory returns [] on failure", async () => {
    h.client.listPortfolios = async () => {
      throw new Error("x");
    };
    expect(await api.loadNetWorthHistory()).toEqual([]);
  });

  it("loadPortfolios values each portfolio's net worth", async () => {
    h.client.listPortfolios = async () => PF;
    h.client.listPortfolioValues = async () => [
      { id: "p1", netWorth: "10" },
      { id: "p2", netWorth: "20" },
    ];
    const res = await api.loadPortfolios();
    expect(res.status).toBe("ok");
    expect(res.portfolios.map((p) => p.netWorth)).toEqual(["10", "20"]);

    h.client.listPortfolios = async () => {
      throw new Error("x");
    };
    expect(await api.loadPortfolios()).toMatchObject({ status: "unavailable" });
  });

  it("loadIncomeStats uses the aggregate, or the per-portfolio twin when selected", async () => {
    h.client.listPortfolios = async () => PF;
    const getIncome = vi.fn(async () => ({ displayCurrency: "IDR", ttm: "12" }));
    const getPortfolioIncome = vi.fn(async (id: string) => ({
      displayCurrency: "EUR",
      ttm: "3",
      _id: id,
    }));
    h.client.getIncome = getIncome;
    h.client.getPortfolioIncome = getPortfolioIncome;

    // No selection → aggregate (no holderId).
    let res = await api.loadIncomeStats();
    expect(res).toMatchObject({ status: "ok" });
    expect(getIncome).toHaveBeenCalledWith(undefined);
    expect(getPortfolioIncome).not.toHaveBeenCalled();

    // Holder scope cookie → passes holderId to getIncome.
    // resolveHolderScope validates: need ≥2 portfolios owned by the holder.
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "holder-abc" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "holder-abc" },
    ];
    h.cookies = { pf: "holder:holder-abc" };
    getIncome.mockClear();
    res = await api.loadIncomeStats();
    expect(res).toMatchObject({ status: "ok" });
    expect(getIncome).toHaveBeenCalledWith("holder-abc");
    expect(getPortfolioIncome).not.toHaveBeenCalled();
    // Restore PF for the next assertion.
    h.client.listPortfolios = async () => PF;

    // A selected portfolio cookie → portfolio path wins.
    h.cookies = { pf: "p2" };
    getIncome.mockClear();
    res = await api.loadIncomeStats();
    expect(res).toMatchObject({ status: "ok" });
    expect(getPortfolioIncome).toHaveBeenCalledWith("p2");
    expect(getIncome).not.toHaveBeenCalled();

    h.cookies = {};
    h.client.listPortfolios = async () => [];
    expect(await api.loadIncomeStats()).toMatchObject({ status: "empty" });
    h.client.listPortfolios = async () => {
      throw new Error("x");
    };
    expect(await api.loadIncomeStats()).toMatchObject({ status: "unavailable" });
  });

  it("loadGoldReport uses the aggregate, or the per-portfolio twin when selected", async () => {
    h.client.listPortfolios = async () => PF;
    const getGold = vi.fn(async () => ({ displayCurrency: "IDR", holdings: [], plans: [] }));
    const getPortfolioGold = vi.fn(async (id: string) => ({
      displayCurrency: "EUR",
      holdings: [],
      plans: [],
      _id: id,
    }));
    h.client.getGold = getGold;
    h.client.getPortfolioGold = getPortfolioGold;

    // No selection → aggregate (no holderId).
    let res = await api.loadGoldReport();
    expect(res).toMatchObject({ status: "ok" });
    expect(getGold).toHaveBeenCalledWith(undefined);
    expect(getPortfolioGold).not.toHaveBeenCalled();

    // Holder scope cookie → passes holderId to getGold.
    // resolveHolderScope validates: need ≥2 portfolios owned by the holder.
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "holder-abc" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "holder-abc" },
    ];
    h.cookies = { pf: "holder:holder-abc" };
    getGold.mockClear();
    res = await api.loadGoldReport();
    expect(res).toMatchObject({ status: "ok" });
    expect(getGold).toHaveBeenCalledWith("holder-abc");
    expect(getPortfolioGold).not.toHaveBeenCalled();
    // Restore PF for the next assertion.
    h.client.listPortfolios = async () => PF;

    // A selected portfolio cookie → portfolio path wins.
    h.cookies = { pf: "p2" };
    getGold.mockClear();
    res = await api.loadGoldReport();
    expect(res).toMatchObject({ status: "ok" });
    expect(getPortfolioGold).toHaveBeenCalledWith("p2");
    expect(getGold).not.toHaveBeenCalled();

    h.cookies = {};
    h.client.listPortfolios = async () => [];
    expect(await api.loadGoldReport()).toMatchObject({ status: "empty" });
    h.client.listPortfolios = async () => {
      throw new Error("x");
    };
    expect(await api.loadGoldReport()).toMatchObject({ status: "unavailable" });
  });

  it("loadContributions reads holder scope from the cookie; portfolio cookie wins", async () => {
    h.client.listPortfolios = async () => PF;
    const getContributions = vi.fn(async () => ({ displayCurrency: "IDR", netContributed: "500" }));
    const getPortfolioContributions = vi.fn(async (id: string) => ({
      displayCurrency: "EUR",
      netContributed: "100",
      _id: id,
    }));
    h.client.getContributions = getContributions;
    h.client.getPortfolioContributions = getPortfolioContributions;

    // No selection → aggregate with undefined holderId.
    let res = await api.loadContributions();
    expect(res).toMatchObject({ status: "ok" });
    expect(getContributions).toHaveBeenCalledWith(undefined);

    // Holder scope cookie → aggregate with holderId.
    // resolveHolderScope validates: need ≥2 portfolios owned by the holder.
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "holder-xyz" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "holder-xyz" },
    ];
    h.cookies = { pf: "holder:holder-xyz" };
    getContributions.mockClear();
    res = await api.loadContributions();
    expect(res).toMatchObject({ status: "ok" });
    expect(getContributions).toHaveBeenCalledWith("holder-xyz");
    // Restore PF for the next assertion.
    h.client.listPortfolios = async () => PF;

    // Portfolio selected cookie → per-portfolio path, no holderId.
    h.cookies = { pf: "p1" };
    getContributions.mockClear();
    res = await api.loadContributions();
    expect(res).toMatchObject({ status: "ok" });
    expect(getPortfolioContributions).toHaveBeenCalledWith("p1");
    expect(getContributions).not.toHaveBeenCalled();

    h.cookies = {};
  });

  it("loadInstrumentResult only reports not_found for a real 404, never a transient error", async () => {
    h.client.getInstrumentHistory = async () => [];
    h.client.listCorporateActions = async () => [];
    h.client.getInstrument = async () => ({ id: "i1" });
    expect(await api.loadInstrumentResult("i1")).toMatchObject({ status: "ok" });

    h.client.getInstrument = async () => {
      throw Object.assign(new Error("nf"), { status: 404 });
    };
    expect(await api.loadInstrumentResult("i1")).toEqual({ status: "not_found" });

    h.client.getInstrument = async () => {
      throw Object.assign(new Error("rl"), { status: 429, retryAfter: 5 });
    };
    expect(await api.loadInstrumentResult("i1")).toEqual({ status: "rate_limited", retryAfter: 5 });

    h.client.getInstrument = async () => {
      throw new Error("network");
    };
    expect(await api.loadInstrumentResult("i1")).toEqual({ status: "unavailable" });
  });

  it("loadMe returns the user or null", async () => {
    h.client.me = async () => ({ id: "u1", authSub: "sub" });
    expect(await api.loadMe()).toMatchObject({ id: "u1" });
    h.accessToken = null;
    expect(await api.loadMe()).toBeNull();
  });
});

// loadHarvestPrefill's tests were retired along with the function itself: the
// harvest-suggestion prefill is now built client-side by `loadHarvestPrefill` in
// `add-transaction-menu.tsx` (see add-transaction-menu.test.tsx), since the
// `/transactions/new` full page it served is now a redirect into the Add sheet.

describe("loadNetworthTax — Indonesian regime (blocker fix)", () => {
  // ID final tax has no allowance/FSA concept, so loadNetworthTax must never call the
  // FSA-gated getPortfolioTax/getNetworthTax endpoints (which 422/skip without one) —
  // it builds a normalized holder stub directly from the portfolio list instead.

  it("single-portfolio scope: returns a stub without calling getPortfolioTax", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    const getPortfolioTax = vi.fn();
    h.client.getPortfolioTax = getPortfolioTax;

    const holders = await api.loadNetworthTax(2026, "ID");
    expect(getPortfolioTax).not.toHaveBeenCalled();
    expect(holders).toHaveLength(1);
    expect(holders[0].holder.id).toBe("p1");
    expect(holders[0].year).toBe(2026);
  });

  it("aggregate scope (no holder-scope cookie): returns exactly one stub without calling getNetworthTax", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = {}; // no single portfolio selected, no holder scope
    const getNetworthTax = vi.fn();
    h.client.getNetworthTax = getNetworthTax;

    const holders = await api.loadNetworthTax(2026, "ID");
    expect(getNetworthTax).not.toHaveBeenCalled();
    expect(holders).toHaveLength(1);
  });

  it("returns an empty array when the user has zero portfolios (not the German empty-state trigger)", async () => {
    h.client.listPortfolios = async () => [];
    expect(await api.loadNetworthTax(2026, "ID")).toEqual([]);
  });

  it("does not affect the German (default) regime's existing FSA-gated behavior", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    h.client.getPortfolioTax = async () => {
      const err = new Error("no fsa") as Error & { status: number };
      err.status = 422;
      throw err;
    };
    // Default regime (omitted) behaves exactly as before this change: 422 → [].
    expect(await api.loadNetworthTax(2026)).toEqual([]);
  });
});

describe("loadTaxYearDetail", () => {
  const baseUsage = {
    year: 2026,
    allowanceAnnual: "1000",
    realizedGainsAdjusted: "0",
    incomeYtd: "0",
    usedYtd: "0",
    taxableExcess: "0",
    remaining: "1000",
    taxRate: "0.25",
    taxSavingAvailable: "250",
    currency: "IDR",
    forecastIncomeRestOfYear: "0",
    projectedUsedFullYear: "0",
    projectedRemaining: "1000",
    projectedTaxSavingAvailable: "250",
  };

  it("returns an empty map without calling the API when there are no holders", async () => {
    const map = await api.loadTaxYearDetail([], 2026);
    expect(map.size).toBe(0);
  });

  it("carries the source payloads' fxMissingCurrencies onto the detail (Tax page FX banner)", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    h.client.getTrades = vi.fn(async () => ({
      displayCurrency: "IDR",
      trades: [],
      realizedByYear: [],
      dividendsByYear: [],
      fxMissingCurrencies: ["USD"],
    }));
    h.client.listIncomeByYear = vi.fn(async () => []);
    const holders = [
      {
        holder: { id: "p1" },
        year: 2026,
        currency: "IDR",
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];
    const detail = (await api.loadTaxYearDetail(holders, 2026)).get("p1");
    expect(detail?.fxMissingCurrencies).toEqual(["USD"]);
  });

  it("marks cash income with nothing to name it by, so the table can label it", async () => {
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    h.client.getTrades = vi.fn(async () => ({
      displayCurrency: "IDR",
      trades: [],
      realizedByYear: [],
      dividendsByYear: [],
    }));
    const row = (o: Record<string, unknown>) => ({
      instrumentId: null,
      instrument: null,
      quantity: "0",
      price: "10",
      fees: "0",
      tax: "0",
      currency: "EUR",
      executedAt: "2026-06-30",
      status: "normal",
      ...o,
    });
    h.client.listIncomeByYear = vi.fn(async () => [
      row({ id: "c1", type: "interest" }),
      row({ id: "c2", type: "interest", description: "Zinsen Tagesgeld", price: "5" }),
      row({ id: "c3", type: "dividend", instrumentId: "abcdef12-3456", price: "7" }),
    ]);
    const holders = [
      {
        holder: { id: "p1" },
        year: 2026,
        currency: "IDR",
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];
    const detail = (await api.loadTaxYearDetail(holders, 2026)).get("p1")!;
    // No instrument, no description: only the type key, so it carries cashType.
    expect(detail.dividendRows).toContainEqual(
      expect.objectContaining({ symbol: "interest", cashType: "interest", gross: "10.00" }),
    );
    // A description names the row; an instrument without a loaded symbol shows its id prefix.
    // Neither is cash income needing a label.
    const named = detail.dividendRows.filter((r) => r.symbol !== "interest");
    expect(named.map((r) => r.symbol).sort()).toEqual(["Zinsen Tagesgeld", "abcdef12"]);
    for (const r of named) expect(r).not.toHaveProperty("cashType");
  });

  it("single-portfolio scope: fetches the FIFO trade log + transactions for that portfolio only", async () => {
    h.client.listPortfolios = async () => PF; // p1 (IDR), p2 (EUR)
    h.cookies = { pf: "p1" };

    const getTrades = vi.fn(async () => ({
      displayCurrency: "IDR",
      trades: [
        {
          instrumentId: "i1",
          instrument: { symbol: "NVDA", name: "NVIDIA", assetClass: "equity", market: "US" },
          legs: [
            {
              acqDate: "2025-01-01",
              sellDate: "2026-03-12",
              quantity: "10",
              cost: "1000",
              proceeds: "1240",
              gain: "240",
              holdingDays: 100,
              longTerm: false,
              taxYear: 2026,
            },
            {
              acqDate: "2024-01-01",
              sellDate: "2025-06-01",
              quantity: "5",
              cost: "400",
              proceeds: "500",
              gain: "100",
              holdingDays: 200,
              longTerm: true,
              taxYear: 2025,
            },
          ],
        },
      ],
      realizedByYear: [
        { year: 2025, amount: "100" },
        { year: 2026, amount: "240" },
      ],
      dividendsByYear: [
        { year: 2025, amount: "180", tax: "47" },
        { year: 2026, amount: "133", tax: "35" },
      ],
    }));
    h.client.getTrades = getTrades;

    const listIncomeByYear = vi.fn(async (id: string) =>
      id === "p1"
        ? [
            {
              id: "t1",
              portfolioId: "p1",
              type: "dividend",
              instrumentId: "i2",
              instrument: { symbol: "SAP" },
              quantity: "0",
              price: "133",
              fees: "0",
              tax: "35",
              currency: "EUR",
              executedAt: "2026-05-01",
              status: "normal",
            },
          ]
        : [],
    );
    h.client.listIncomeByYear = listIncomeByYear;

    const holders = [
      {
        holder: { id: "p1" },
        year: 2026,
        currency: "IDR",
        allowanceUsage: {
          ...baseUsage,
          realizedGainsAdjusted: "240",
          incomeYtd: "168",
          usedYtd: "408",
          remaining: "592",
        },
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];

    const map = await api.loadTaxYearDetail(holders, 2026);
    expect(getTrades).toHaveBeenCalledWith("p1", "fifo");
    expect(listIncomeByYear).toHaveBeenCalledWith("p1", 2026);
    expect(listIncomeByYear).not.toHaveBeenCalledWith("p2");

    const detail = map.get("p1");
    expect(detail).toBeDefined();
    // Only the 2026 leg — the 2025 leg is excluded from the disposal table (scoped to
    // the selected tax year), but still folds into the by-year rollup below.
    // A single-lot disposal — grouped, but with only one leg in `.lots` (a multi-lot
    // disposal is covered separately below).
    expect(detail!.disposals).toEqual([
      {
        symbol: "NVDA",
        when: "2026-03-12",
        // The underlying instrumentId is threaded through so the UI can disambiguate
        // rows that share a displayed `symbol` (dual-listed tickers, the
        // `instrumentId.slice(0, 8)` fallback for unnamed instruments, etc.) — see the
        // disposal-table.tsx row key.
        instrumentId: "i1",
        proceeds: "1240.00",
        gain: "240.00",
        // No tfRatesByInstrument entry for this instrument in the fixture → defaults to
        // 0, so gainAdjusted equals the gross gain.
        tfRate: "0",
        gainAdjusted: "240.00",
        quantity: "10",
        avgBuyPrice: "100",
        sellPrice: "124",
        lots: [
          {
            acqDate: "2025-01-01",
            quantity: "10",
            buyPrice: "100",
            sellPrice: "124",
            proceeds: "1240",
            gain: "240",
            holdingDays: 100,
            longTerm: false,
          },
        ],
      },
    ]);
    expect(detail!.totalProceeds).toBe("1240.00");
    expect(detail!.totalGain).toBe("240.00");

    // Dividend: price=133 net-credited (qty=0 → lump-sum branch), tax=35 withheld →
    // gross = net + tax, not qty × price. Rendered in the transaction's OWN currency
    // (EUR) — these amounts are NOT FX-converted to the holder's display currency (IDR).
    expect(detail!.dividendRows).toEqual([
      { symbol: "SAP", currency: "EUR", gross: "168.00", tax: "35.00", net: "133.00" },
    ]);
    expect(detail!.dividendTotalsByCurrency).toEqual([
      { currency: "EUR", gross: "168.00", tax: "35.00", net: "133.00" },
    ]);

    // By year, newest first. The selected year (2026) ties out to the already-loaded
    // allowanceUsage figures: taxable = max(0, 240 + 168 − 408) = 0 → tax "0.00",
    // fsaUsed = allowanceUsage.usedYtd = "408".
    expect(detail!.byYear).toEqual([
      { year: 2026, realized: "240", dividends: "168", fsaUsed: "408", tax: "0.00" },
      // 2025 uses the plain (non-TF-adjusted) trade-log figures and applies the
      // *current* allowance uniformly: taxable = max(0, 100 + 227 − 1000) = 0,
      // fsaUsed = min(1000, max(0, 100 + 227)) = 327.00.
      { year: 2025, realized: "100", dividends: "227.00", fsaUsed: "327.00", tax: "0.00" },
    ]);
  });

  it("groups multi-lot disposals into one aggregate row with a per-lot breakdown", async () => {
    // An ETF bought in two tranches then sold in a single order — FIFO emits one leg
    // per consumed lot, both sharing the sell date. The loader must group same-
    // instrument/same-sell-date legs into ONE disposal row (an aggregate avg buy →
    // sell price) rather than one row per lot — see loadTaxYearDetail's doc comment.
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    h.client.getTrades = async () => ({
      displayCurrency: "IDR",
      trades: [
        {
          instrumentId: "i-iwda",
          instrument: {
            symbol: "IWDA",
            name: "iShares MSCI World",
            assetClass: "equity",
            market: "US",
          },
          legs: [
            {
              acqDate: "2022-06-10",
              sellDate: "2026-04-01",
              quantity: "8",
              cost: "644",
              proceeds: "771.2",
              gain: "127.2",
              holdingDays: 1400,
              longTerm: true,
              taxYear: 2026,
            },
            {
              // Listed second in the feed — the loader sorts lots by acqDate, so this
              // earlier-acquired lot must still come first in the grouped `.lots`.
              acqDate: "2021-01-15",
              sellDate: "2026-04-01",
              quantity: "12",
              cost: "853.2",
              proceeds: "1156.8",
              gain: "303.6",
              holdingDays: 1900,
              longTerm: true,
              taxYear: 2026,
            },
          ],
        },
      ],
      realizedByYear: [],
      dividendsByYear: [],
    });
    h.client.listIncomeByYear = async () => [];

    const holders = [
      {
        holder: { id: "p1" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
        // 30% Teilfreistellung for this ETF, same map allowanceUsage was computed with.
        tfRatesByInstrument: { "i-iwda": "0.30" },
      },
    ] as unknown as TaxSummaryHolder[];

    const detail = (await api.loadTaxYearDetail(holders, 2026)).get("p1")!;
    // ONE row, not two — the two legs (same instrument, same sell date) collapse.
    expect(detail.disposals).toHaveLength(1);
    const [row] = detail.disposals;
    expect(row.symbol).toBe("IWDA");
    expect(row.when).toBe("2026-04-01");
    expect(row.quantity).toBe("20"); // 12 + 8
    expect(row.proceeds).toBe("1928.00"); // 1156.8 + 771.2
    expect(row.gain).toBe("430.80"); // 303.6 + 127.2
    expect(row.tfRate).toBe("0.3");
    expect(row.gainAdjusted).toBe("301.56"); // 430.80 × 0.70
    // avg buy price = Σcost/Σqty = (853.2+644)/20 = 74.86; sell price = Σproceeds/Σqty = 96.4
    expect(Number(row.avgBuyPrice)).toBeCloseTo(74.86, 2);
    expect(Number(row.sellPrice)).toBeCloseTo(96.4, 2);
    // Both lots retained, sorted oldest-acquired first.
    expect(row.lots).toHaveLength(2);
    expect(row.lots.map((l) => l.acqDate)).toEqual(["2021-01-15", "2022-06-10"]);
    expect(row.lots[0].quantity).toBe("12");
    expect(row.lots[0].proceeds).toBe("1156.8");
    expect(row.lots[0].gain).toBe("303.6");
  });

  it("groups dividend rows per currency instead of mislabeling/summing across currencies", async () => {
    // No client-side FX path exists for these raw transaction amounts (unlike every
    // other figure on the page, which comes pre-converted from the backend trade log),
    // so a holder with dividends in two currencies must get two distinct rows/totals —
    // never a single sum mislabeled with the display currency.
    h.client.listPortfolios = async () => PF;
    h.cookies = { pf: "p1" };
    h.client.getTrades = async () => ({
      displayCurrency: "IDR",
      trades: [],
      realizedByYear: [],
      dividendsByYear: [],
    });
    h.client.listIncomeByYear = async () => [
      {
        id: "t1",
        portfolioId: "p1",
        type: "dividend",
        instrumentId: "i-sap",
        instrument: { symbol: "SAP" },
        quantity: "0",
        price: "133",
        fees: "0",
        tax: "35",
        currency: "EUR",
        executedAt: "2026-05-01",
        status: "normal",
      },
      {
        id: "t2",
        portfolioId: "p1",
        type: "dividend",
        instrumentId: "i-nvda",
        instrument: { symbol: "NVDA" },
        quantity: "0",
        price: "80",
        fees: "0",
        tax: "20",
        currency: "USD",
        executedAt: "2026-06-01",
        status: "normal",
      },
    ];

    const holders = [
      {
        holder: { id: "p1" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];

    const detail = (await api.loadTaxYearDetail(holders, 2026)).get("p1")!;
    expect(detail.dividendRows).toEqual(
      expect.arrayContaining([
        { symbol: "SAP", currency: "EUR", gross: "168.00", tax: "35.00", net: "133.00" },
        { symbol: "NVDA", currency: "USD", gross: "100.00", tax: "20.00", net: "80.00" },
      ]),
    );
    // Two separate per-currency totals — NOT one combined "268" sum across EUR + USD.
    expect(detail.dividendTotalsByCurrency).toEqual([
      { currency: "EUR", gross: "168.00", tax: "35.00", net: "133.00" },
      { currency: "USD", gross: "100.00", tax: "20.00", net: "80.00" },
    ]);
  });

  it("holder scope: fetches one FIFO trade log per holder via getNetWorthTrades", async () => {
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "h1" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "h2" },
    ];
    h.cookies = {}; // aggregate — no single portfolio selected

    const getNetWorthTrades = vi.fn(async () => ({
      displayCurrency: "IDR",
      trades: [],
      realizedByYear: [],
      dividendsByYear: [],
    }));
    h.client.getNetWorthTrades = getNetWorthTrades;
    h.client.listIncomeByYear = async () => [];

    const holders = [
      {
        holder: { id: "h1" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
      {
        holder: { id: "h2" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];

    const map = await api.loadTaxYearDetail(holders, 2026);
    expect(map.size).toBe(2);
    expect(getNetWorthTrades).toHaveBeenCalledWith("fifo", undefined, "h1");
    expect(getNetWorthTrades).toHaveBeenCalledWith("fifo", undefined, "h2");
  });

  it("isolates a per-holder failure — one holder's fetch throwing doesn't drop the others", async () => {
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "h1" },
      { id: "p2", name: "B", baseCurrency: "EUR", accountHolderId: "h2" },
    ];
    h.cookies = {};
    h.client.getNetWorthTrades = async (
      _method: string,
      _costBasis: string | undefined,
      holderId: string,
    ) => {
      if (holderId === "h1") throw new Error("boom");
      return { displayCurrency: "EUR", trades: [], realizedByYear: [], dividendsByYear: [] };
    };
    h.client.listIncomeByYear = async () => [];

    const holders = [
      {
        holder: { id: "h1" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
      {
        holder: { id: "h2" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];

    const map = await api.loadTaxYearDetail(holders, 2026);
    expect(map.has("h1")).toBe(false);
    expect(map.has("h2")).toBe(true);
  });

  it("returns an empty map when not signed in", async () => {
    h.accessToken = null;
    const holders = [
      {
        holder: { id: "h1" },
        year: 2026,
        allowanceUsage: baseUsage,
        harvestSuggestions: [],
        distribution: {},
      },
    ] as unknown as TaxSummaryHolder[];
    expect((await api.loadTaxYearDetail(holders, 2026)).size).toBe(0);
  });

  it("ID aggregate scope: merges every holder's final-tax payload, foreign income kept apart", async () => {
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR", accountHolderId: "h1" },
      { id: "p2", name: "B", baseCurrency: "IDR", accountHolderId: "h2" },
    ];
    h.cookies = {};
    h.client.getPreferences = async () => ({ taxRegime: "ID" });
    const getNetWorthTrades = vi.fn(async () => ({
      displayCurrency: "IDR",
      trades: [],
      realizedByYear: [],
      dividendsByYear: [],
    }));
    h.client.getNetWorthTrades = getNetWorthTrades;
    h.client.listIncomeByYear = async () => [];
    const row = (o: Record<string, unknown>) => ({
      symbol: "X",
      currency: "IDR",
      rate: "0.10",
      net: null,
      withheldAtSource: false,
      taxBasis: "estimated",
      foreignTaxWithheld: null,
      ...o,
    });
    // Each holder's payload as the API computes it (core `indonesianFinalTax`).
    const payload = (income: Record<string, unknown>[], salesTax: string) => ({
      disposals: [],
      totalProceeds: "0",
      totalSalesTax: salesTax,
      income,
      byYear: [],
    });
    h.client.getNetworthTax = async () => [
      {
        holder: { id: "h1" },
        currency: "IDR",
        indonesianFinalTax: payload(
          [
            row({ symbol: "BBCA", category: "domestic_dividend", gross: "1000", tax: "100" }),
            row({
              symbol: "AAPL",
              category: "foreign",
              rate: null,
              gross: "500",
              tax: null,
              foreignTaxWithheld: "75",
            }),
          ],
          "10",
        ),
      },
      {
        holder: { id: "h2" },
        currency: "IDR",
        indonesianFinalTax: payload(
          [
            row({
              symbol: "interest",
              category: "deposit_interest",
              rate: "0.20",
              gross: "200",
              tax: "40",
              withheldAtSource: true,
            }),
          ],
          "0",
        ),
      },
    ];

    const holders = [
      { holder: { id: "__id_all_portfolios__" }, year: 2026, harvestSuggestions: [] },
    ] as unknown as TaxSummaryHolder[];
    const detail = (await api.loadTaxYearDetail(holders, 2026)).get("__id_all_portfolios__")!;
    const id = detail.indonesianFinalTax!;
    expect(id.income.map((r) => r.symbol)).toEqual(["BBCA", "AAPL", "interest"]);
    expect(id.totalIncomeGross).toBe("1200.00");
    expect(id.totalIncomeTax).toBe("140.00");
    expect(id.foreignIncomeGross).toBe("500.00");
    expect(id.foreignTaxWithheld).toBe("75.00");
    expect(id.estimatedTax).toBe("150.00");
    expect(id.taxWithheldAtSource).toBe("50.00");
    expect(id.taxToSelfPay).toBe("100.00");
    // The sentinel is never sent to the API as a holder id (it 500'd there and blanked the
    // whole ID detail).
    expect(getNetWorthTrades).toHaveBeenCalledWith("fifo", undefined, undefined);
  });

  it("ID_ALL_PORTFOLIOS aggregate sentinel resolves to every portfolio in scope (not grouped by account holder)", async () => {
    // Two portfolios, neither linked to any account holder — the German aggregate path
    // would show nothing for holders like this (it only groups by accountHolderId).
    h.client.listPortfolios = async () => [
      { id: "p1", name: "A", baseCurrency: "IDR" },
      { id: "p2", name: "B", baseCurrency: "IDR" },
    ];
    h.cookies = {}; // aggregate, no holder-scope cookie
    h.client.listAccountHolders = async () => [];

    const idHolders = await api.loadNetworthTax(2026, "ID");
    expect(idHolders).toHaveLength(1);

    const getNetWorthTrades = vi.fn(async () => ({
      displayCurrency: "IDR",
      trades: [],
      realizedByYear: [],
      dividendsByYear: [],
    }));
    h.client.getNetWorthTrades = getNetWorthTrades;
    const listIncomeByYear = vi.fn(async () => []);
    h.client.listIncomeByYear = listIncomeByYear;

    await api.loadTaxYearDetail(idHolders, 2026);
    // Both portfolios' income is fetched — the sentinel resolved to "every
    // portfolio", not filtered down by a (non-existent) accountHolderId match.
    expect(listIncomeByYear).toHaveBeenCalledWith("p1", 2026);
    expect(listIncomeByYear).toHaveBeenCalledWith("p2", 2026);
  });
});

describe("loadAdminStorageProviders", () => {
  it("returns ok with storage config on success", async () => {
    h.client.getAdminStorageProviders = async () => ({
      activeProvider: "s3",
      s3: { endpoint: "", region: "eu-central-1", bucket: "test", hasSecret: false },
      folder: { path: "./.storage" },
      encryptionEnabled: false,
    });
    const res = await api.loadAdminStorageProviders();
    expect(res).toMatchObject({ status: "ok" });
    expect((res as { status: "ok"; storage: unknown }).storage).toHaveProperty(
      "activeProvider",
      "s3",
    );
  });

  it("returns unavailable when the API throws", async () => {
    h.client.getAdminStorageProviders = async () => {
      throw new Error("forbidden");
    };
    expect(await api.loadAdminStorageProviders()).toMatchObject({
      status: "unavailable",
    });
  });

  it("returns unavailable when not signed in", async () => {
    h.accessToken = null;
    expect(await api.loadAdminStorageProviders()).toMatchObject({
      status: "unavailable",
    });
  });
});

describe("getServerApi when auth is not configured", () => {
  it("returns unavailable even with a session", async () => {
    vi.resetModules();
    delete process.env.AUTH_SECRET;
    const fresh = await import("../src/lib/server-api");
    h.accessToken = "tok";
    expect(await fresh.loadMe()).toBeNull();
    // restore for any later imports
    process.env.AUTH_SECRET = "test-secret";
  });
});

describe("loadAnomalyBadge", () => {
  it("counts aggregate anomalies and flags error severity", async () => {
    h.client.getNetworthAnomalies = async () => ({
      anomalies: [{ severity: "warning" }, { severity: "error" }, { severity: "warning" }],
    });
    expect(await api.loadAnomalyBadge()).toEqual({ count: 3, hasError: true });
  });

  it("uses the selected portfolio's anomalies when one is selected", async () => {
    h.cookies = { pf: "p2" };
    const getAnomalies = vi.fn(async () => ({ anomalies: [{ severity: "warning" }] }));
    h.client.getAnomalies = getAnomalies;
    expect(await api.loadAnomalyBadge()).toEqual({ count: 1, hasError: false });
    expect(getAnomalies).toHaveBeenCalledWith("p2");
  });

  it("shows no badge when the fetch fails", async () => {
    h.client.getNetworthAnomalies = async () => {
      throw new Error("x");
    };
    expect(await api.loadAnomalyBadge()).toEqual({ count: 0, hasError: false });
  });
});
