import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Echoes keys (the assertions below match on them), but only for keys that exist in BOTH
// catalogues — a label missing from en/id fails here instead of rendering its raw key.
vi.mock("next-intl/server", async () => {
  const en = (await import("../messages/en.json")).default as Record<string, unknown>;
  const id = (await import("../messages/id.json")).default as Record<string, unknown>;
  const resolve = (bag: unknown, key: string) =>
    key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bag);
  return {
    getTranslations: async (ns: string) => (key: string) => {
      for (const [name, cat] of [
        ["en", en],
        ["id", id],
      ] as const) {
        if (typeof resolve(cat[ns], key) !== "string")
          throw new Error(`missing message ${ns}.${key} in ${name}.json`);
      }
      return key;
    },
  };
});

const data = vi.hoisted(() => ({ incomeStatsOnce: vi.fn() }));
vi.mock("@/components/income/income-data", () => data);

// Heavy client children are out of scope — marker stubs exposing what we assert on.
vi.mock("@/components/charts/lazy", () => ({
  LazyIncomeBarChart: (p: { data: { label: string; projected?: number }[] }) => (
    <div data-testid="bars">{JSON.stringify(p.data)}</div>
  ),
  LazyAllocationDonut: (p: { data: { key: string }[] }) => (
    <div data-testid="donut">{p.data.map((d) => d.key).join(",")}</div>
  ),
}));
vi.mock("@/components/charts/income-bar-legend", () => ({ IncomeBarChartLegend: () => null }));
vi.mock("@/components/charts/income-heatmap", () => ({
  IncomeHeatmap: () => <div data-testid="heatmap" />,
}));
vi.mock("@/components/income/yields-table", () => ({
  YieldsTable: (p: { rows: unknown[] }) => <div data-testid="yields">{p.rows.length}</div>,
}));
vi.mock("@/components/income/income-timeline", () => ({
  IncomeTimeline: (p: { rows: unknown[]; olderYears: string[] }) => (
    <div data-testid="timeline">
      {p.rows.length}|{p.olderYears.join(",")}
    </div>
  ),
}));
vi.mock("@/components/income/income-calendar", () => ({
  IncomeCalendar: () => <div data-testid="calendar" />,
}));
vi.mock("@/components/income/income-calendar-empty", () => ({
  IncomeCalendarEmpty: () => <div data-testid="calendar-empty" />,
}));

import {
  IncomeYearChartSection,
  IncomeSeasonalitySection,
  IncomeSummarySection,
  IncomeCalendarSection,
  IncomeTimelineSection,
  IncomeStatsSection,
  IncomeCashInterestSection,
  IncomeAllocationSection,
  IncomeCurrencySection,
} from "../src/components/income/income-sections";

const year = String(new Date().getUTCFullYear());

function stats(over: Record<string, unknown> = {}) {
  return {
    status: "ok" as const,
    data: {
      displayCurrency: "EUR",
      events: [{ date: `${year}-03-01`, id: "e1" }],
      upcoming: [],
      yields: [],
      byYear: [{ year, total: "100" }],
      monthly: [],
      byInstrument: [],
      byCurrency: [{ currency: "EUR", totalNormalized: "100" }],
      byAssetClass: [{ assetClass: "equity", total: "100" }],
      forecastFullYear: "150",
      forecastRestOfYear: "50",
      forecastNextYear: "200",
      lastYear: "100",
      ttm: "120",
      lifetimeTotal: "500",
      paymentCount: 7,
      averagePerPayment: "10",
      interest: { ytd: "1", ttm: "2", lifetime: "3" },
      ...over,
    },
  };
}

beforeEach(() => {
  data.incomeStatsOnce.mockReset();
  data.incomeStatsOnce.mockResolvedValue(stats());
});

describe("Income sections", () => {
  it("every section renders nothing when the stats are not ok", async () => {
    data.incomeStatsOnce.mockResolvedValue({ status: "unavailable" });
    expect(await IncomeYearChartSection()).toBeNull();
    expect(await IncomeSeasonalitySection()).toBeNull();
    expect(await IncomeSummarySection({ locale: "en" })).toBeNull();
    expect(await IncomeCalendarSection()).toBeNull();
    expect(await IncomeTimelineSection({ locale: "en" })).toBeNull();
    expect(await IncomeStatsSection({ locale: "en" })).toBeNull();
    expect(await IncomeCashInterestSection({ locale: "en" })).toBeNull();
    expect(await IncomeAllocationSection()).toBeNull();
    expect(await IncomeCurrencySection()).toBeNull();
  });

  it("year chart adds the projected rest-of-year to the current year and a next-year forecast bar", async () => {
    render(await IncomeYearChartSection());
    const bars = JSON.parse(screen.getByTestId("bars").textContent ?? "[]");
    expect(bars[0]).toMatchObject({ label: year, value: 100, projected: 50 });
    expect(bars[1]).toMatchObject({ label: "nextYear", value: 200, forecast: true });
  });

  it("skips the heatmap without monthly data and shows it with some", async () => {
    expect(await IncomeSeasonalitySection()).toBeNull();
    data.incomeStatsOnce.mockResolvedValue(stats({ monthly: [{ month: "2026-01" }] }));
    render(await IncomeSeasonalitySection());
    expect(screen.getByTestId("heatmap")).toBeInTheDocument();
  });

  it("summary lists contributors and yields, and hides when there is nothing to summarise", async () => {
    expect(await IncomeSummarySection({ locale: "en" })).toBeNull();
    data.incomeStatsOnce.mockResolvedValue(
      stats({
        byInstrument: [{ instrumentId: "i1", symbol: "AAA", name: "Aaa", total: "40", pct: 0.4 }],
        yields: [{ instrumentId: "i1" }],
      }),
    );
    render(await IncomeSummarySection({ locale: "en" }));
    expect(screen.getByText("AAA")).toBeInTheDocument();
    expect(screen.getByTestId("yields")).toHaveTextContent("1");
  });

  it("calendar shows the empty state without upcoming payments", async () => {
    const { unmount } = render(await IncomeCalendarSection());
    expect(screen.getByTestId("calendar-empty")).toBeInTheDocument();
    unmount();
    data.incomeStatsOnce.mockResolvedValue(stats({ upcoming: [{ id: "u" }] }));
    render(await IncomeCalendarSection());
    expect(screen.getByTestId("calendar")).toBeInTheDocument();
  });

  it("timeline merges events + upcoming and lists years outside the events window", async () => {
    data.incomeStatsOnce.mockResolvedValue(
      stats({
        upcoming: [{ id: "u", kind: "dividend", date: `${year}-12-01` }],
        byYear: [
          { year, total: "1" },
          { year: "2019", total: "1" },
          { year: "2021", total: "1" },
        ],
      }),
    );
    render(await IncomeTimelineSection({ locale: "en" }));
    expect(screen.getByTestId("timeline")).toHaveTextContent("2|2021,2019");
  });

  it("stat cards show the full-year outlook, trailing figures and payment count", async () => {
    render(await IncomeStatsSection({ locale: "en" }));
    // The value is the full-year estimate (received + forecast), so the label says so.
    expect(screen.getByText("thisYearEstimate")).toBeInTheDocument();
    expect(screen.queryByText("thisYear")).not.toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("cash interest only renders when there is lifetime interest", async () => {
    render(await IncomeCashInterestSection({ locale: "en" }));
    expect(screen.getByText("cashInterest")).toBeInTheDocument();
    data.incomeStatsOnce.mockResolvedValue(
      stats({ interest: { ytd: "0", ttm: "0", lifetime: "0" } }),
    );
    expect(await IncomeCashInterestSection({ locale: "en" })).toBeNull();
    // An API without the field (validation is off in production) hides the line, no throw.
    data.incomeStatsOnce.mockResolvedValue(stats({ interest: undefined }));
    expect(await IncomeCashInterestSection({ locale: "en" })).toBeNull();
  });

  it("allocation donut lists asset classes; currency split needs more than one currency", async () => {
    render(await IncomeAllocationSection());
    expect(screen.getByTestId("donut")).toHaveTextContent("equity");
    expect(await IncomeCurrencySection()).toBeNull();
    data.incomeStatsOnce.mockResolvedValue(
      stats({
        byCurrency: [
          { currency: "EUR", totalNormalized: "300" },
          { currency: "USD", totalNormalized: "200" },
        ],
      }),
    );
    render(await IncomeCurrencySection());
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(screen.getByText("40.0%")).toBeInTheDocument();
  });
});
