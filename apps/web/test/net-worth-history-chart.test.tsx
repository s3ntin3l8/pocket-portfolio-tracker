import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HistoryPoint, PerformancePoint, IntradayPoint } from "@portfolio/api-client";

// Stub the recharts-backed single-series chart so the card-variant test stays
// light and deterministic.
vi.mock("@/components/charts/price-chart", () => ({
  PriceChart: () => <div data-testid="chart" />,
}));
// Stub the new two-line hero chart so the hero-variant tests can assert on its
// presence without recharts' SVG plumbing (jsdom doesn't lay out the
// ResponsiveContainer, so the real component renders no <path> data).
vi.mock("@/components/charts/hero-overlay-chart", () => ({
  HeroOverlayChart: (props: {
    points: Array<{ date: string; portfolio: number; benchmark: number | null }>;
  }) => (
    <div
      data-testid="hero-overlay-chart"
      data-points={props.points.length}
      data-has-benchmark={String(props.points.some((p) => p.benchmark !== null))}
    />
  ),
}));
const getNetWorthHistory = vi.fn(async (): Promise<HistoryPoint[]> => [
  { date: "2026-01-01", netWorth: "100" },
  { date: "2026-02-01", netWorth: "200" },
  { date: "2026-03-01", netWorth: "300" },
]);
const getPortfolioHistory = vi.fn(async (): Promise<HistoryPoint[]> => [
  { date: "2026-01-01", netWorth: "50" },
  { date: "2026-02-01", netWorth: "75" },
]);
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ getNetWorthHistory, getPortfolioHistory }),
}));

import { NetWorthHistoryChart } from "../src/components/charts/net-worth-history-chart";

const initial: PerformancePoint[] = [
  { date: "2026-01-01", netWorth: "100" },
  { date: "2026-02-01", netWorth: "200" },
];

function renderChart() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NetWorthHistoryChart initial={initial} currency="IDR" />
    </NextIntlClientProvider>,
  );
}

describe("NetWorthHistoryChart", () => {
  beforeEach(() => {
    getNetWorthHistory.mockClear();
    getPortfolioHistory.mockClear();
  });

  it("renders the initial series without fetching", () => {
    renderChart();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(getNetWorthHistory).not.toHaveBeenCalled();
  });

  it("refetches the series when the range changes", async () => {
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "3M" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("3m"));
  });

  it("uses getPortfolioHistory instead of getNetWorthHistory when selectedId is set", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart initial={initial} currency="IDR" selectedId="p2" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "3M" }));
    await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalledWith("p2", "3m"));
    expect(getNetWorthHistory).not.toHaveBeenCalled();
  });

  it("renders timestamped 1D data (the intraday `at` shape) as a chart", async () => {
    const intradayPoints: IntradayPoint[] = [
      { at: "2026-06-01T02:00:00.000Z", netWorth: "100", marketValue: "100" },
      { at: "2026-06-01T02:15:00.000Z", netWorth: "110", marketValue: "110" },
    ];
    getNetWorthHistory.mockResolvedValueOnce(intradayPoints);
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
    expect(await screen.findByTestId("chart")).toBeInTheDocument();
  });

  it("shows a collecting-data note instead of a blank/broken chart when no intraday points exist yet", async () => {
    getNetWorthHistory.mockResolvedValueOnce([]);
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(screen.getByText(/Collecting intraday data/i)).toBeInTheDocument());
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("disables the Performance mode toggle for intraday ranges", async () => {
    getNetWorthHistory.mockResolvedValueOnce([
      { at: "2026-06-01T02:00:00.000Z", netWorth: "100", marketValue: "100" },
      { at: "2026-06-01T02:15:00.000Z", netWorth: "110", marketValue: "110" },
    ] as IntradayPoint[]);
    renderChart();
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
    const perfButton = screen.getByRole("button", { name: "Performance" });
    expect(perfButton).toBeDisabled();
  });

  describe("hero variant", () => {
    it("renders real intraday values (not the collecting note) once ≥2 points exist, with no mode toggle and only the 5 hero range chips", async () => {
      const intradayPoints: IntradayPoint[] = [
        { at: "2026-06-01T02:00:00.000Z", netWorth: "1000", marketValue: "1000" },
        { at: "2026-06-01T03:00:00.000Z", netWorth: "1050", marketValue: "1050" },
        { at: "2026-06-01T04:00:00.000Z", netWorth: "1020", marketValue: "1020" },
      ];
      getNetWorthHistory.mockResolvedValueOnce(intradayPoints);
      const onSeriesChange = vi.fn();

      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={initial}
            currency="IDR"
            variant="hero"
            onSeriesChange={onSeriesChange}
          />
        </NextIntlClientProvider>,
      );

      // Hero has no Performance/Value mode toggle.
      expect(screen.queryByRole("button", { name: "Performance" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Value" })).not.toBeInTheDocument();

      // Only the 5 hero chips render (no 3M/YTD).
      expect(screen.getByRole("button", { name: "1D" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "7D" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "1M" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "1Y" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "3M" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "YTD" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "1D" }));
      await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));

      expect(await screen.findByTestId("hero-overlay-chart")).toBeInTheDocument();
      expect(screen.queryByText(/Collecting intraday data/i)).not.toBeInTheDocument();

      // The caller-visible series carries the real fetched values, not a placeholder.
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        expect(lastCall?.[1]).toBe("1d");
        expect(lastCall?.[0].points).toEqual([
          { date: expect.any(String), close: 1000 },
          { date: expect.any(String), close: 1050 },
          { date: expect.any(String), close: 1020 },
        ]);
      });
    });

    it("shows the collecting note (not a broken chart) when fewer than 2 intraday points exist", async () => {
      getNetWorthHistory.mockResolvedValueOnce([]);
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart initial={initial} currency="IDR" variant="hero" />
        </NextIntlClientProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "1D" }));
      await waitFor(() =>
        expect(screen.getByText(/Collecting intraday data/i)).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("hero-overlay-chart")).not.toBeInTheDocument();
    });
  });

  describe("hero variant with benchmark overlay", () => {
    const pointsWithBenchmark: PerformancePoint[] = [
      { date: "2026-01-01", netWorth: "100", pct: "0", benchmarkPct: "0" },
      { date: "2026-02-01", netWorth: "110", pct: "10", benchmarkPct: "5" },
      { date: "2026-03-01", netWorth: "120", pct: "20", benchmarkPct: "8" },
    ];
    const pointsWithoutBenchmark: PerformancePoint[] = [
      { date: "2026-01-01", netWorth: "100", pct: "0" },
      { date: "2026-02-01", netWorth: "110", pct: "10" },
    ];

    it("renders the new HeroOverlayChart in the hero variant (not the legacy PriceChart)", () => {
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={pointsWithBenchmark}
            currency="IDR"
            variant="hero"
            initialRange="1y"
          />
        </NextIntlClientProvider>,
      );
      expect(screen.getByTestId("hero-overlay-chart")).toBeInTheDocument();
    });

    it("emits benchmark series via onSeriesChange when benchmark data is present", async () => {
      const onSeriesChange = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={pointsWithBenchmark}
            currency="IDR"
            variant="hero"
            initialRange="1y"
            onSeriesChange={onSeriesChange}
          />
        </NextIntlClientProvider>,
      );
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toMatchObject({
          hasBenchmark: true,
          benchmarkPct: "8",
        });
        expect(lastCall?.[0].points.length).toBe(3);
      });
    });

    it("emits hasBenchmark=false when benchmark data is absent", async () => {
      const onSeriesChange = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={pointsWithoutBenchmark}
            currency="IDR"
            variant="hero"
            initialRange="1y"
            onSeriesChange={onSeriesChange}
          />
        </NextIntlClientProvider>,
      );
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        expect(lastCall?.[0]).toMatchObject({ hasBenchmark: false });
      });
    });

    it("hides the overlay for intraday ranges (1D/7D)", async () => {
      const intraday: IntradayPoint[] = [
        { at: "2026-06-01T02:00:00.000Z", netWorth: "1000", marketValue: "1000" },
        { at: "2026-06-01T03:00:00.000Z", netWorth: "1050", marketValue: "1050" },
      ];
      getNetWorthHistory.mockResolvedValueOnce(intraday);
      const onSeriesChange = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={pointsWithBenchmark}
            currency="IDR"
            variant="hero"
            initialRange="1y"
            onSeriesChange={onSeriesChange}
          />
        </NextIntlClientProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "1D" }));
      await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        // Intraday emits hasBenchmark=false (no benchmark intraday data).
        expect(lastCall?.[0]).toMatchObject({ hasBenchmark: false });
      });
    });
  });
});
