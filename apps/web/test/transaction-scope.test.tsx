import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import messages from "../messages/en.json";

/**
 * The Activity ledger's scope (audit R4-C1) and the Holdings scope encoding (audit R4-C2).
 *
 * The page and the loaders are exercised for real here — only the API client, the request
 * scope (the `x-pocket-scope` header the proxy sets) and the client components are stubbed.
 * The scope is therefore resolved by the production code path: a header that names a
 * portfolio or a holder, the `pf` cookie as the fallback, and the aggregate otherwise.
 */
const h = vi.hoisted(() => {
  // The auth env must be set BEFORE the server-api module is imported: `authConfigured` is
  // a module-level constant.
  process.env.AUTH_SECRET = "test-secret"; // pragma: allowlist secret
  process.env.AUTHENTIK_ISSUER = "https://auth.test/o/p/";
  return {
    accessToken: "tok" as string | null,
    cookies: {} as Record<string, string>,
    requestHeaders: {} as Record<string, string>,
    portfolios: [] as {
      id: string;
      name: string;
      baseCurrency: string;
      accountHolderId: string | null;
    }[],
    rowsByPortfolio: {} as Record<
      string,
      { id: string; portfolioId: string; executedAt: string }[]
    >,
    calls: {
      /** Portfolio ids whose transaction list was read. */
      portfolioLists: [] as string[],
      /** Portfolio ids whose anomalies were read. */
      anomalyReads: [] as string[],
      networthLists: 0,
      networthAnomalyReads: 0,
    },
    // `never[]` params so any concretely-typed stub assigns.
    client: {} as Record<string, (...args: never[]) => unknown>,
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
  createApiClient: () => h.client,
}));

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (ns: string) => {
    const bag = (messages as unknown as Record<string, Record<string, string>>)[ns] ?? {};
    return (key: string) => bag[key] ?? key;
  },
}));

// Client components are out of scope here — stub them with identifiable markers. The
// transactions table is stubbed with its props, so the rendered rows can be asserted.
vi.mock("@/components/transactions-table", () => ({
  TransactionsTable: (props: { rows: { id: string }[]; showPortfolio?: boolean }) => (
    <div
      data-testid="tx-table"
      data-rows={props.rows.map((r) => r.id).join(",")}
      data-show-portfolio={String(props.showPortfolio)}
    />
  ),
}));
vi.mock("@/components/add-transaction-menu", () => ({
  AddTransactionMenu: () => <div data-testid="add-menu" />,
}));
vi.mock("@/components/portfolio-form-dialog", () => ({
  PortfolioFormDialog: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="create-portfolio">{trigger}</div>
  ),
}));
vi.mock("@/components/export-csv-button", () => ({ ExportCsvButton: () => null }));
vi.mock("@/components/export-documents-button", () => ({ ExportDocumentsButton: () => null }));
vi.mock("@/components/recent-imports-section", () => ({ RecentImportsSection: () => null }));
vi.mock("@/components/fx-missing-banner", () => ({ FxMissingBanner: () => null }));
vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import TransactionsPage from "../src/app/[locale]/(app)/transactions/page";
import { loadAnomalyBadge } from "@/lib/server-api";
import { resolveEffectiveScope, legacyScopeValue } from "@/lib/server-api/_shared";

const PORTFOLIOS = [
  { id: "p1", name: "Depot A", baseCurrency: "EUR", accountHolderId: "h1" },
  { id: "p2", name: "Depot B", baseCurrency: "EUR", accountHolderId: "h1" },
  { id: "p3", name: "Depot C", baseCurrency: "EUR", accountHolderId: "h2" },
];

beforeEach(() => {
  h.accessToken = "tok";
  h.cookies = {};
  h.requestHeaders = {};
  h.portfolios = PORTFOLIOS;
  h.rowsByPortfolio = {
    p1: [{ id: "t1", portfolioId: "p1", executedAt: "2026-01-02T00:00:00.000Z" }],
    p2: [{ id: "t2", portfolioId: "p2", executedAt: "2026-01-01T00:00:00.000Z" }],
    p3: [{ id: "t3", portfolioId: "p3", executedAt: "2026-01-03T00:00:00.000Z" }],
  };
  h.calls = {
    portfolioLists: [],
    anomalyReads: [],
    networthLists: 0,
    networthAnomalyReads: 0,
  };
  h.client = {
    me: async () => ({ isAdmin: false, displayCurrency: "EUR" }),
    listPortfolios: async () => h.portfolios,
    listImports: async () => [],
    listTransactionsPaginated: async (portfolioId: string) => {
      h.calls.portfolioLists.push(portfolioId);
      const rows = h.rowsByPortfolio[portfolioId] ?? [];
      return { rows, total: rows.length, summary: null, years: [], draftCount: 0 };
    },
    listNetworthTransactionsPaginated: async () => {
      h.calls.networthLists += 1;
      return { rows: [], total: 0, summary: null, years: [], draftCount: 0 };
    },
    getAnomalies: async (portfolioId: string) => {
      h.calls.anomalyReads.push(portfolioId);
      return { anomalies: [{ code: "negative_cash", severity: "warning", scope: "transaction" }] };
    },
    getNetworthAnomalies: async () => {
      h.calls.networthAnomalyReads += 1;
      // The aggregate set is deliberately different from any single portfolio's: two
      // anomalies, one of them error-severity. A badge that counted the wrong scope is
      // therefore visible in the count AND in the error flag.
      return {
        anomalies: [
          { code: "negative_cash", severity: "warning", scope: "transaction" },
          { code: "duplicate_transaction", severity: "error", scope: "transaction" },
        ],
      };
    },
  };
});

describe("the Activity ledger follows the scope it is in (audit R4-C1)", () => {
  it("lists the holder's own portfolios under a holder scope — never the aggregate", async () => {
    h.requestHeaders = { "x-pocket-scope": "h:h1" };

    const ui = await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });
    render(ui);

    // The holder's two portfolios are read, the other holder's portfolio never is.
    expect(h.calls.portfolioLists.sort()).toEqual(["p1", "p2"]);
    expect(h.calls.portfolioLists).not.toContain("p3");
    // The aggregate endpoints stay untouched — that was the bug.
    expect(h.calls.networthLists).toBe(0);
    expect(h.calls.networthAnomalyReads).toBe(0);
    // The ledger shows the holder's rows only (newest first).
    expect(screen.getByTestId("tx-table").getAttribute("data-rows")).toBe("t1,t2");
    // A holder scope spans several portfolios, so the Portfolio column belongs.
    expect(screen.getByTestId("tx-table").getAttribute("data-show-portfolio")).toBe("true");
  });

  it("reads the anomalies of the holder's portfolios, not the aggregate", async () => {
    h.requestHeaders = { "x-pocket-scope": "h:h1" };

    await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });

    expect(h.calls.anomalyReads.sort()).toEqual(["p1", "p2"]);
    expect(h.calls.networthAnomalyReads).toBe(0);
  });

  it("reads the selected portfolio under a portfolio scope", async () => {
    h.requestHeaders = { "x-pocket-scope": "p:p2" };

    const ui = await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });
    render(ui);

    expect(h.calls.portfolioLists).toEqual(["p2"]);
    expect(h.calls.anomalyReads).toEqual(["p2"]);
    expect(h.calls.networthLists).toBe(0);
    expect(h.calls.networthAnomalyReads).toBe(0);
    expect(screen.getByTestId("tx-table").getAttribute("data-rows")).toBe("t2");
    expect(screen.getByTestId("tx-table").getAttribute("data-show-portfolio")).toBe("false");
  });

  it("aggregates every portfolio when no scope is selected", async () => {
    const ui = await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });
    render(ui);

    expect(h.calls.networthLists).toBe(1);
    expect(h.calls.networthAnomalyReads).toBe(1);
    expect(h.calls.portfolioLists).toEqual([]);
  });

  it("falls back to the `pf` cookie when the URL carries no scope", async () => {
    h.cookies = { pf: "p1" };

    const ui = await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });
    render(ui);

    expect(h.calls.portfolioLists).toEqual(["p1"]);
    expect(h.calls.networthLists).toBe(0);
  });
});

describe("resolveEffectiveScope", () => {
  it("keeps a holder scope only for a holder that owns ≥2 portfolios", async () => {
    h.requestHeaders = { "x-pocket-scope": "h:h1" };
    expect(await resolveEffectiveScope(h.portfolios)).toEqual({ kind: "holder", holderId: "h1" });

    // A single-portfolio holder is equivalent to that portfolio: the scope collapses to
    // the aggregate, exactly like on every other scope-aware page.
    expect(await resolveEffectiveScope([h.portfolios[0]])).toEqual({ kind: "all" });
  });

  it("passes a portfolio scope through and falls back to the aggregate", async () => {
    h.requestHeaders = { "x-pocket-scope": "p:p1" };
    expect(await resolveEffectiveScope(h.portfolios)).toEqual({
      kind: "portfolio",
      portfolioId: "p1",
    });

    h.requestHeaders = {};
    expect(await resolveEffectiveScope(h.portfolios)).toEqual({ kind: "all" });
  });
});

describe("the Holdings page resolves its anomalies through the scope (audit R4-C2)", () => {
  it("never falls back to the all-portfolios anomaly set on that page", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/app/[locale]/(app)/holdings/page.tsx"),
      "utf8",
    );
    // The positions table under a holder scope is holder-filtered, so the anomaly banners
    // over them have to be the holder's anomalies too — the aggregate set would put a
    // second scope on one screen. The scope-aware entry point is the only way to get it.
    expect(source).toContain("loadScopeAnomalies(effectiveScope)");
    expect(source).not.toContain("loadNetworthAnomalies");
  });
});

describe("the Activity badge counts the scope the page renders", () => {
  it("counts the holder's own portfolios when the holder owns several", async () => {
    h.requestHeaders = { "x-pocket-scope": "h:h1" };

    const badge = await loadAnomalyBadge();

    expect(h.calls.anomalyReads.sort()).toEqual(["p1", "p2"]);
    expect(h.calls.networthAnomalyReads).toBe(0);
    expect(badge.count).toBe(2);
  });

  it("counts the aggregate for a holder that owns a single portfolio", async () => {
    // h2 owns exactly one portfolio (p3). The switcher's rule collapses such a holder
    // scope to the aggregate, so the Activity page renders the aggregate — the badge has
    // to count the aggregate too, or it labels a different set than the page shows.
    h.requestHeaders = { "x-pocket-scope": "h:h2" };

    const badge = await loadAnomalyBadge();

    expect(h.calls.networthAnomalyReads).toBe(1);
    expect(h.calls.anomalyReads).toEqual([]);
    // The aggregate's two anomalies — not the single portfolio's one.
    expect(badge.count).toBe(2);
    expect(badge.hasError).toBe(true);
  });

  it("renders the aggregate on the Activity page for the same single-portfolio holder", async () => {
    h.requestHeaders = { "x-pocket-scope": "h:h2" };

    await TransactionsPage({ params: Promise.resolve({ locale: "en" }) });

    // The page and the badge now read the very same set.
    expect(h.calls.networthAnomalyReads).toBe(1);
    expect(h.calls.anomalyReads).toEqual([]);
  });
});

describe("legacyScopeValue (?portfolio= → ?scope=p:)", () => {
  it("translates a legacy deep link into the documented scope form", () => {
    expect(legacyScopeValue({ portfolio: "p1" })).toBe("p:p1");
    expect(legacyScopeValue({ scope: "p:p2", portfolio: "p1" })).toBe("p:p2");
    expect(legacyScopeValue({ scope: "h:h1", portfolio: "p1" })).toBe("h:h1");
  });

  it("has nothing to translate without a valid legacy parameter", () => {
    expect(legacyScopeValue({})).toBeNull();
    // A URL that already carries the documented scope needs no translation (and must not
    // be redirected onto itself).
    expect(legacyScopeValue({ scope: "p:p2" })).toBeNull();
    expect(legacyScopeValue({ portfolio: "not a portfolio id" })).toBeNull();
    expect(legacyScopeValue({ scope: "nonsense", portfolio: "not a portfolio id" })).toBeNull();
  });
});
