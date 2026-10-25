import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NetWorth } from "@portfolio/api-client";

// Server-side translations resolve to their own key so assertions don't depend on ICU text.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const loaders = vi.hoisted(() => {
  const loadAnomalies = vi.fn();
  const loadNetworthAnomalies = vi.fn();
  const loadHolderAnomalies = vi.fn();
  return {
    loadHasIntraday: vi.fn(),
    loadNetWorthHistory: vi.fn(),
    loadNetWorthHolderScope: vi.fn(),
    getSelectedPortfolioId: vi.fn(),
    loadAnomalies,
    loadNetworthAnomalies,
    loadHolderAnomalies,
    // Mirrors the real scope-aware entry point: one portfolio, one holder's portfolios,
    // or the all-portfolios aggregate.
    loadScopeAnomalies: vi.fn(
      async (scope: { kind: string; portfolioId?: string; holderId?: string }) => {
        if (scope.kind === "portfolio") return loadAnomalies(scope.portfolioId);
        if (scope.kind === "holder") return loadHolderAnomalies(scope.holderId);
        return loadNetworthAnomalies();
      },
    ),
  };
});
vi.mock("@/lib/server-api", () => loaders);

// Client children are out of scope — stub them with markers that expose the props we care about.
const heroProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("@/components/holdings/hero-glance-card", () => ({
  HeroGlanceCard: (p: Record<string, unknown>) => {
    heroProps.last = p;
    return <div data-testid="hero" />;
  },
}));
vi.mock("@/components/holdings/portfolio-value-card", () => ({
  PortfolioValueCard: (p: Record<string, string | null>) => (
    <div data-testid="value-card">
      {p.totalValueFormatted}|{p.allTimePct}|{p.todayPct}
    </div>
  ),
}));
vi.mock("@/components/holdings/allocation-card", () => ({
  AllocationCard: (p: { slices: { key: string; atCostValue?: number }[] }) => (
    <div data-testid="alloc">{JSON.stringify(p.slices.map((s) => [s.key, s.atCostValue]))}</div>
  ),
}));
vi.mock("@/components/holdings/region-currency-card", () => ({
  RegionCurrencyCard: () => <div data-testid="region" />,
}));
vi.mock("@/components/gain-explainer", () => ({
  GainExplainer: () => <span data-testid="explainer" />,
}));
vi.mock("@/components/scope-link", () => ({
  ScopeLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/reconciliation-banner-group", () => ({
  ReconciliationBannerGroup: ({ items }: { items: unknown[] }) => (
    <div data-testid="recon">{items.length}</div>
  ),
}));

import {
  HoldingsHeroSection,
  startHoldingsHeroData,
} from "../src/components/holdings/holdings-hero-section";
import { HoldingsAnomalySection } from "../src/components/holdings/holdings-anomaly-section";
import { HoldingsSidebar } from "../src/components/holdings/holdings-sidebar";

function summary(over: Partial<NetWorth> = {}): NetWorth {
  return {
    netWorth: "1000",
    displayCurrency: "EUR",
    totalCost: "800",
    totalMarketValue: "1000",
    totalUnrealizedPnL: "200",
    totalDayChange: "50",
    holdings: [
      {
        valuedAtCost: true,
        fxMissing: false,
        marketValueDisplay: "300",
        instrument: { assetClass: "equity" },
      },
      {
        valuedAtCost: false,
        fxMissing: true,
        marketValueDisplay: null,
        instrument: { assetClass: "gold" },
      },
    ],
    allocation: {
      byAssetClass: [
        { key: "equity", value: "300", pct: 30 },
        { key: "gold", value: "0", pct: 0 },
      ],
      byRegion: [{ key: "europe", value: "300", pct: 30 }],
      byCurrency: [{ key: "EUR", value: "300", pct: 30 }],
    },
    ...over,
  } as unknown as NetWorth;
}

beforeEach(() => {
  heroProps.last = null;
  loaders.loadHasIntraday.mockResolvedValue(false);
  loaders.loadNetWorthHistory.mockResolvedValue([{ date: "2026-01-01", value: "1" }]);
  loaders.loadNetWorthHolderScope.mockResolvedValue("holder-1");
  loaders.getSelectedPortfolioId.mockResolvedValue("p1");
  loaders.loadAnomalies.mockResolvedValue([]);
  loaders.loadNetworthAnomalies.mockResolvedValue([]);
});

describe("HoldingsHeroSection", () => {
  it("passes the resolved history/scope and the at-cost / FX-missing counts to the hero", async () => {
    const data = startHoldingsHeroData(undefined);
    render(
      await HoldingsHeroSection({
        summary: summary(),
        data,
        portfolioParam: "p9",
        benchmarkSymbol: "^GDAXI",
      }),
    );
    expect(screen.getByTestId("hero")).toBeInTheDocument();
    expect(heroProps.last).toMatchObject({
      netWorth: "1000",
      currency: "EUR",
      initialRange: "1y",
      selectedId: "p1",
      holderId: "holder-1",
      benchmarkSymbol: "^GDAXI",
      atCostCount: 1,
      fxMissingCount: 1,
      atCostHref: "/holdings?portfolio=p9&filter=at-cost",
    });
    expect(heroProps.last?.initialHistory).toHaveLength(1);
  });

  it("falls back from an intraday ?range= when no intraday data exists", async () => {
    const data = startHoldingsHeroData("1d");
    render(await HoldingsHeroSection({ summary: summary(), data, benchmarkSymbol: "^GSPC" }));
    expect(heroProps.last?.initialRange).toBe("1y");
    expect(loaders.loadNetWorthHistory).toHaveBeenCalledWith("1y");
  });

  it("keeps an intraday ?range= when intraday data exists", async () => {
    loaders.loadHasIntraday.mockResolvedValue(true);
    const data = startHoldingsHeroData("1d");
    render(await HoldingsHeroSection({ summary: summary(), data, benchmarkSymbol: "^GSPC" }));
    expect(heroProps.last?.initialRange).toBe("1d");
  });

  it("does not raise an unhandled rejection when the page never renders the hero", async () => {
    loaders.loadNetWorthHistory.mockRejectedValue(new Error("boom"));
    const data = startHoldingsHeroData(undefined);
    await expect(data).rejects.toThrow("boom");
  });
});

describe("HoldingsAnomalySection", () => {
  it("uses the aggregate endpoint for the all-portfolios scope and renders nothing when clean", async () => {
    const { container } = render(
      await HoldingsAnomalySection({ locale: "en", scope: { kind: "all" } }),
    );
    expect(loaders.loadNetworthAnomalies).toHaveBeenCalled();
    expect(loaders.loadAnomalies).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toBe("0");
  });

  it("shows the error banner linking to Transactions for row-attached anomalies", async () => {
    loaders.loadAnomalies.mockResolvedValue([
      { code: "oversell", severity: "error", transactionId: "t1" },
    ]);
    render(
      await HoldingsAnomalySection({
        locale: "en",
        scope: { kind: "portfolio", portfolioId: "p1" },
      }),
    );
    expect(loaders.loadAnomalies).toHaveBeenCalledWith("p1");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("bannerError");
    expect(screen.getByRole("link", { name: "viewTransactions" })).toHaveAttribute(
      "href",
      "/transactions",
    );
  });

  it("uses the holder's own anomalies under a holder scope, never the aggregate", async () => {
    // The positions table under a holder scope shows that holder's portfolios, so the
    // banners over them must be the holder's anomalies too — the all-portfolios set would
    // be a second scope on one screen.
    loaders.loadHolderAnomalies.mockResolvedValue([]);
    render(
      await HoldingsAnomalySection({ locale: "en", scope: { kind: "holder", holderId: "h1" } }),
    );
    expect(loaders.loadHolderAnomalies).toHaveBeenCalledWith("h1");
    expect(loaders.loadNetworthAnomalies).not.toHaveBeenCalled();
    expect(loaders.loadAnomalies).not.toHaveBeenCalled();
  });

  it("uses the warning variant when there are only warnings, and the combined one for both", async () => {
    loaders.loadNetworthAnomalies.mockResolvedValue([
      { code: "x", severity: "warning", transactionId: "t1" },
    ]);
    const { unmount } = render(
      await HoldingsAnomalySection({ locale: "en", scope: { kind: "all" } }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("bannerWarning");
    unmount();

    loaders.loadNetworthAnomalies.mockResolvedValue([
      { code: "x", severity: "warning", transactionId: "t1" },
      { code: "y", severity: "error", transactionId: "t2" },
    ]);
    render(await HoldingsAnomalySection({ locale: "en", scope: { kind: "all" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("bannerBoth");
  });

  it("routes portfolio-level anomalies to the reconciliation banner group, not the headline count", async () => {
    loaders.loadNetworthAnomalies.mockResolvedValue([
      { code: "reconciliation_gap", severity: "warning", meta: {} },
    ]);
    render(await HoldingsAnomalySection({ locale: "en", scope: { kind: "all" } }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("recon")).toHaveTextContent("1");
  });
});

describe("HoldingsSidebar", () => {
  it("renders nothing without an allocation", async () => {
    const { container } = render(
      await HoldingsSidebar({ summary: summary({ allocation: undefined }), locale: "en" }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the value, allocation (with at-cost share) and region cards", async () => {
    render(await HoldingsSidebar({ summary: summary(), locale: "en" }));
    expect(screen.getByTestId("value-card").textContent).toMatch(/1[.,]?000/);
    // Zero-value slices are filtered out; the at-cost value rides on its class.
    expect(screen.getByTestId("alloc")).toHaveTextContent('[["equity",300]]');
    expect(screen.getByTestId("region")).toBeInTheDocument();
  });

  it("omits percentages when the base is non-positive", async () => {
    render(
      await HoldingsSidebar({
        summary: summary({ totalCost: "0", totalMarketValue: "10", totalDayChange: "10" }),
        locale: "en",
      }),
    );
    expect(screen.getByTestId("value-card").textContent).toMatch(/\|\|$/);
  });
});
