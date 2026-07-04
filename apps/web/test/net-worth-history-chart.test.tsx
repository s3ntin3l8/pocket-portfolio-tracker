import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HistoryPoint, PerformancePoint, IntradayPoint } from "@portfolio/api-client";

// Stub the recharts-backed chart so the test stays light and deterministic.
vi.mock("@/components/charts/price-chart", () => ({
  PriceChart: () => <div data-testid="chart" />,
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
    await waitFor(() =>
      expect(getPortfolioHistory).toHaveBeenCalledWith("p2", "3m"),
    );
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
    await waitFor(() =>
      expect(
        screen.getByText(/Collecting intraday data/i),
      ).toBeInTheDocument(),
    );
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
});
