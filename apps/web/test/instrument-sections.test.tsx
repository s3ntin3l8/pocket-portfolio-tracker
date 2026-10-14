import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const data = vi.hoisted(() => ({
  instrumentOnce: vi.fn(),
  scopeOnce: vi.fn(),
  anomaliesOnce: vi.fn(),
  incomeStatsOnce: vi.fn(),
  meOnce: vi.fn(),
  instrumentTxOnce: vi.fn(),
  selectedPortfolioIdOnce: vi.fn(),
}));
vi.mock("@/components/instrument/instrument-data", () => data);

const incomeProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
const txProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("@/components/instrument-price-card", () => ({
  InstrumentPriceCard: (p: { instrumentId: string; lastPrice: { price: number } | null }) => (
    <div data-testid="price">
      {p.instrumentId}|{p.lastPrice?.price}
    </div>
  ),
}));
vi.mock("@/components/instrument-income-card", () => ({
  InstrumentIncomeCard: (p: Record<string, unknown>) => {
    incomeProps.last = p;
    return <div data-testid="income" />;
  },
}));
vi.mock("@/components/corporate-actions-manager", () => ({
  CorporateActionsManager: (p: { items: unknown[]; isAdmin: boolean }) => (
    <div data-testid="corp">
      {p.items.length}|{String(p.isAdmin)}
    </div>
  ),
}));
vi.mock("@/components/transactions-table", () => ({
  TransactionsTable: (p: Record<string, unknown>) => {
    txProps.last = p;
    return <div data-testid="tx" />;
  },
}));
vi.mock("@/components/instrument-lots-table", () => ({
  InstrumentLotsTable: (p: { lots: unknown[]; currency: string }) => (
    <div data-testid="lots">
      {p.lots.length}|{p.currency}
    </div>
  ),
}));

import {
  InstrumentPriceSection,
  InstrumentLotsSection,
  InstrumentIncomeSection,
  InstrumentTransactionsSection,
  InstrumentCorporateActionsSection,
  InstrumentPositionSection,
} from "../src/components/instrument/instrument-sections";

const instrument = {
  id: "i1",
  symbol: "AAA",
  currency: "USD",
  assetClass: "equity",
  couponRate: null,
  maturityDate: null,
};
const holding = {
  quantity: "10",
  avgCost: "5",
  currency: "USD",
  costBasisDisplay: "50",
  marketValueDisplay: "100",
  unrealizedPnLDisplay: "50",
  lots: [{ id: "l1" }],
};
const filters = { page: 1 };

beforeEach(() => {
  incomeProps.last = null;
  txProps.last = null;
  data.instrumentOnce.mockResolvedValue({
    status: "ok",
    data: {
      instrument,
      history: [{ close: "9" }, { close: "10" }],
      corporateActions: [{ id: "c1" }],
    },
  });
  data.scopeOnce.mockResolvedValue({
    holding,
    aggregate: false,
    displayCurrency: "EUR",
    totalMarketValueDisplay: 400,
  });
  data.anomaliesOnce.mockResolvedValue([]);
  data.incomeStatsOnce.mockResolvedValue({ status: "unavailable" });
  data.meOnce.mockResolvedValue({ isAdmin: true });
  data.selectedPortfolioIdOnce.mockResolvedValue("p1");
  data.instrumentTxOnce.mockResolvedValue({
    status: "ok",
    rows: [{ id: "t1" }],
    total: 1,
    years: ["2026"],
    draftCount: 0,
  });
});

describe("Instrument sections", () => {
  it("sections render nothing when the instrument did not load", async () => {
    data.instrumentOnce.mockResolvedValue({ status: "unavailable" });
    expect(await InstrumentPriceSection({ id: "i1" })).toBeNull();
    expect(await InstrumentLotsSection({ id: "i1" })).toBeNull();
    expect(await InstrumentIncomeSection({ id: "i1", locale: "en" })).toBeNull();
    expect(await InstrumentCorporateActionsSection({ id: "i1" })).toBeNull();
    expect(await InstrumentPositionSection({ id: "i1", locale: "en" })).toBeNull();
  });

  it("price card gets the last candle as the headline price", async () => {
    render(await InstrumentPriceSection({ id: "i1" }));
    expect(screen.getByTestId("price")).toHaveTextContent("i1|10");
  });

  it("open lots render in the holding's currency, and not at all without lots", async () => {
    render(await InstrumentLotsSection({ id: "i1" }));
    expect(screen.getByTestId("lots")).toHaveTextContent("1|USD");
    data.scopeOnce.mockResolvedValue({ holding: null, displayCurrency: "EUR" });
    expect(await InstrumentLotsSection({ id: "i1" })).toBeNull();
  });

  it("income card has no figures when income stats are unavailable", async () => {
    render(await InstrumentIncomeSection({ id: "i1", locale: "en" }));
    expect(incomeProps.last).toMatchObject({ dividendsReceived: null, yieldOnCost: null });
  });

  it("income card shows this instrument's total in the stats' currency, plus yield and bond terms", async () => {
    data.instrumentOnce.mockResolvedValue({
      status: "ok",
      data: {
        instrument: {
          ...instrument,
          assetClass: "bond",
          couponRate: "0.05",
          maturityDate: "2030-01-15",
        },
        history: [],
        corporateActions: [],
      },
    });
    data.incomeStatsOnce.mockResolvedValue({
      status: "ok",
      data: {
        displayCurrency: "EUR",
        byInstrument: [{ instrumentId: "i1", total: "12.5" }],
        yields: [{ instrumentId: "i1", yieldOnCost: "0.04" }],
      },
    });
    render(await InstrumentIncomeSection({ id: "i1", locale: "en" }));
    expect(incomeProps.last?.dividendsReceived).toMatch(/12\.50/);
    expect(incomeProps.last?.yieldOnCost).toMatch(/4/);
    expect(incomeProps.last?.bondInfo).toMatchObject({ label: "bondTermsLabel" });
  });

  it("transactions table gets the scope currency and only this instrument's anomalies", async () => {
    data.anomaliesOnce.mockResolvedValue([
      { code: "oversell", severity: "error", instrumentId: "i1", transactionId: "t1" },
      { code: "oversell", severity: "error", instrumentId: "other", transactionId: "t2" },
      { code: "reconciliation_gap", severity: "warning", scope: "portfolio" },
    ]);
    render(await InstrumentTransactionsSection({ id: "i1", filters }));
    expect(screen.getByText("bannerError")).toBeInTheDocument();
    expect(txProps.last).toMatchObject({
      scopeCurrency: "EUR",
      showPortfolio: false,
      portfolioId: "p1",
      total: 1,
      instrumentId: "i1",
    });
    expect(txProps.last?.anomalies).toHaveLength(1);
  });

  it("shows the aggregate portfolio column when no portfolio is selected", async () => {
    data.selectedPortfolioIdOnce.mockResolvedValue(null);
    render(await InstrumentTransactionsSection({ id: "i1", filters }));
    expect(txProps.last).toMatchObject({ showPortfolio: true, portfolioId: undefined });
  });

  it("empty transactions show the empty state unless a filter is active", async () => {
    data.instrumentTxOnce.mockResolvedValue({ status: "ok", rows: [], total: 0, years: [] });
    render(await InstrumentTransactionsSection({ id: "i1", filters }));
    expect(screen.getByText("noTransactions")).toBeInTheDocument();
    expect(txProps.last).toBeNull();
    render(await InstrumentTransactionsSection({ id: "i1", filters: { page: 1, q: "x" } }));
    expect(txProps.last).not.toBeNull();
  });

  it("corporate actions know whether the viewer is an admin", async () => {
    render(await InstrumentCorporateActionsSection({ id: "i1" }));
    expect(screen.getByTestId("corp")).toHaveTextContent("1|true");
    data.meOnce.mockResolvedValue(null);
    render(await InstrumentCorporateActionsSection({ id: "i1" }));
    expect(screen.getAllByTestId("corp")[1]).toHaveTextContent("1|false");
  });

  it("position card shows value, P&L with its percentage and the portfolio weight", async () => {
    render(await InstrumentPositionSection({ id: "i1", locale: "en" }));
    expect(screen.getByText("marketValueLabel")).toBeInTheDocument();
    expect(screen.getByText("25.0%")).toBeInTheDocument();
  });

  it("position card shows an em dash P&L when valued at cost, and the empty state when not held", async () => {
    data.scopeOnce.mockResolvedValue({
      holding: { ...holding, unrealizedPnLDisplay: null, marketValueDisplay: null },
      displayCurrency: "EUR",
      totalMarketValueDisplay: 400,
    });
    const { unmount } = render(await InstrumentPositionSection({ id: "i1", locale: "en" }));
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    unmount();
    data.scopeOnce.mockResolvedValue({ holding: null, displayCurrency: "EUR" });
    render(await InstrumentPositionSection({ id: "i1", locale: "en" }));
    expect(screen.getByText("noPosition")).toBeInTheDocument();
  });
});
