import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HistoryPoint, PerformancePoint, IntradayPoint } from "@portfolio/api-client";

// Stub the recharts-backed single-series chart so the card-variant test stays
// light and deterministic.
const chartProps: Array<{ data: unknown[] }> = [];
vi.mock("@/components/charts/price-chart", () => ({
  PriceChart: (props: { data: unknown[] }) => {
    chartProps.push(props);
    return <div data-testid="chart" />;
  },
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

  it("renders the initial series without fetching", async () => {
    renderChart();
    expect(await screen.findByTestId("chart")).toBeInTheDocument();
    expect(getNetWorthHistory).not.toHaveBeenCalled();
  });

  it("discloses carried-forward days on the value line, and not when none carry (#1189)", async () => {
    const carried: PerformancePoint[] = [
      { date: "2026-01-01", netWorth: "100" },
      { date: "2026-01-02", netWorth: "150", netWorthCarried: true },
      { date: "2026-01-03", netWorth: "160", netWorthCarried: true },
    ];
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart initial={carried} currency="IDR" />
      </NextIntlClientProvider>,
    );
    // The default mode is Performance (TWR, unaffected): no note there.
    expect(screen.queryByText(/carried-forward value/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Value" }));
    expect(await screen.findByText(/2 days include a carried-forward value/)).toBeInTheDocument();
    unmount();

    renderChart();
    fireEvent.click(screen.getByRole("radio", { name: "Value" }));
    expect(screen.queryByText(/carried-forward value/)).not.toBeInTheDocument();
  });

  it("refetches the series when the range changes", async () => {
    renderChart();
    fireEvent.click(screen.getByRole("radio", { name: "3M" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("3m"));
  });

  it("forwards the holder scope when refetching", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart initial={initial} currency="IDR" holderId="h1" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "3M" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("3m", { holderId: "h1" }));
  });

  it("ignores a stale slow response that resolves after a newer pick", async () => {
    let resolveSlow!: (v: HistoryPoint[]) => void;
    getNetWorthHistory.mockImplementationOnce(
      () => new Promise<HistoryPoint[]>((res) => (resolveSlow = res)),
    );
    renderChart();
    fireEvent.click(screen.getByRole("radio", { name: "3M" })); // slow
    getNetWorthHistory.mockImplementationOnce(async () => [
      { date: "2026-01-01", netWorth: "1" },
      { date: "2026-02-01", netWorth: "2" },
      { date: "2026-03-01", netWorth: "3" },
      { date: "2026-04-01", netWorth: "4" },
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "1M" })); // fast, newer
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    await act(async () => {
      resolveSlow([
        { date: "2026-01-01", netWorth: "998" },
        { date: "2026-02-01", netWorth: "999" },
      ]);
    });
    expect(chartProps.at(-1)?.data).toHaveLength(4);
  });

  it("uses getPortfolioHistory instead of getNetWorthHistory when selectedId is set", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart initial={initial} currency="IDR" selectedId="p2" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "3M" }));
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
    fireEvent.click(screen.getByRole("radio", { name: "1D" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
    expect(await screen.findByTestId("chart")).toBeInTheDocument();
  });

  it("shows a collecting-data note instead of a blank/broken chart when no intraday points exist yet", async () => {
    getNetWorthHistory.mockResolvedValueOnce([]);
    renderChart();
    fireEvent.click(screen.getByRole("radio", { name: "1D" }));
    await waitFor(() => expect(screen.getByText(/Collecting intraday data/i)).toBeInTheDocument());
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("disables the Performance mode toggle for intraday ranges", async () => {
    getNetWorthHistory.mockResolvedValueOnce([
      { at: "2026-06-01T02:00:00.000Z", netWorth: "100", marketValue: "100" },
      { at: "2026-06-01T02:15:00.000Z", netWorth: "110", marketValue: "110" },
    ] as IntradayPoint[]);
    renderChart();
    fireEvent.click(screen.getByRole("radio", { name: "1D" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
    const perfButton = screen.getByRole("radio", { name: "Performance" });
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
      expect(screen.queryByRole("radio", { name: "Performance" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Value" })).not.toBeInTheDocument();

      // Only the 5 hero chips render (no 3M/YTD).
      expect(screen.getByRole("radio", { name: "1D" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "7D" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "1M" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "1Y" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "All" })).toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "3M" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "YTD" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("radio", { name: "1D" }));
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
      fireEvent.click(screen.getByRole("radio", { name: "1D" }));
      await waitFor(() =>
        expect(screen.getByText(/Collecting intraday data/i)).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("hero-overlay-chart")).not.toBeInTheDocument();
    });
  });

  describe("selected portfolio with no securities sleeve (cash-only)", () => {
    const cashOnly: IntradayPoint[] = [
      { at: "2026-06-01T02:00:00.000Z", netWorth: "1000", marketValue: "0" },
      { at: "2026-06-01T03:00:00.000Z", netWorth: "1050", marketValue: "0" },
    ];

    it("plots netWorth even when marketValue is non-zero (the line always matches the headline)", async () => {
      getPortfolioHistory.mockResolvedValueOnce([
        { at: "2026-06-01T02:00:00.000Z", netWorth: "1000", marketValue: "900" },
        { at: "2026-06-01T03:00:00.000Z", netWorth: "1050", marketValue: "950" },
      ] as IntradayPoint[]);
      const onSeriesChange = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={initial}
            currency="EUR"
            variant="hero"
            selectedId="p-loan"
            onSeriesChange={onSeriesChange}
          />
        </NextIntlClientProvider>,
      );
      fireEvent.click(screen.getByRole("radio", { name: "1D" }));
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        expect(lastCall?.[1]).toBe("1d");
        expect(lastCall?.[0].points.map((p: { close: number }) => p.close)).toEqual([1000, 1050]);
      });
    });

    it("plots netWorth, not the zero marketValue, on the hero's intraday line", async () => {
      getPortfolioHistory.mockResolvedValueOnce(cashOnly);
      const onSeriesChange = vi.fn();
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart
            initial={initial}
            currency="EUR"
            variant="hero"
            selectedId="p-cash"
            onSeriesChange={onSeriesChange}
          />
        </NextIntlClientProvider>,
      );
      fireEvent.click(screen.getByRole("radio", { name: "1D" }));
      await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalledWith("p-cash", "1d"));
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        expect(lastCall?.[1]).toBe("1d");
        expect(lastCall?.[0].points.map((p: { close: number }) => p.close)).toEqual([1000, 1050]);
      });
    });

    it("plots netWorth in the card variant's intraday and Value series", async () => {
      getPortfolioHistory.mockResolvedValueOnce(cashOnly);
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <NetWorthHistoryChart initial={initial} currency="EUR" selectedId="p-cash" />
        </NextIntlClientProvider>,
      );
      fireEvent.click(screen.getByRole("radio", { name: "1D" }));
      await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalledWith("p-cash", "1d"));
      await waitFor(() =>
        expect(chartProps.at(-1)?.data).toEqual([
          { date: expect.any(String), close: "1000" },
          { date: expect.any(String), close: "1050" },
        ]),
      );

      getPortfolioHistory.mockResolvedValueOnce([
        { date: "2026-01-01", netWorth: "500", marketValue: "0", index: "100", pct: "0" },
        { date: "2026-02-01", netWorth: "510", marketValue: "0", index: "100", pct: "0" },
      ] as PerformancePoint[]);
      fireEvent.click(screen.getByRole("radio", { name: "3M" }));
      await waitFor(() => expect(getPortfolioHistory).toHaveBeenCalledWith("p-cash", "3m"));
      fireEvent.click(screen.getByRole("radio", { name: "Value" }));
      await waitFor(() =>
        expect(chartProps.at(-1)?.data).toEqual([
          { date: "2026-01-01", close: "500" },
          { date: "2026-02-01", close: "510" },
        ]),
      );
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

    it("holds the emission while a range fetch is in flight, then emits once with the new range", async () => {
      let resolve!: (v: HistoryPoint[]) => void;
      getNetWorthHistory.mockImplementationOnce(
        () => new Promise<HistoryPoint[]>((r) => (resolve = r)),
      );
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
      await waitFor(() => expect(onSeriesChange).toHaveBeenCalled());
      onSeriesChange.mockClear();
      fireEvent.click(screen.getByRole("radio", { name: "1M" }));
      await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1m"));
      // Range already flipped, data still the old series: nothing may be emitted yet.
      expect(onSeriesChange).not.toHaveBeenCalled();
      await act(async () => resolve(pointsWithBenchmark));
      await waitFor(() => expect(onSeriesChange).toHaveBeenCalledTimes(1));
      expect(onSeriesChange.mock.calls[0]?.[1]).toBe("1m");
    });

    it("never emits the old series under the new range when the refetch fails", async () => {
      getNetWorthHistory.mockRejectedValueOnce(new Error("boom"));
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
      await waitFor(() => expect(onSeriesChange).toHaveBeenCalled());
      onSeriesChange.mockClear();
      fireEvent.click(screen.getByRole("radio", { name: "1M" }));
      await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1m"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(onSeriesChange).not.toHaveBeenCalled();
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
      fireEvent.click(screen.getByRole("radio", { name: "1D" }));
      await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
      await waitFor(() => {
        const lastCall = onSeriesChange.mock.calls.at(-1);
        // Intraday emits hasBenchmark=false (no benchmark intraday data).
        expect(lastCall?.[0]).toMatchObject({ hasBenchmark: false });
      });
    });
  });
});

describe("NetWorthHistoryChart hero range as URL state", () => {
  beforeEach(() => {
    getNetWorthHistory.mockClear();
    window.history.replaceState(null, "", "/holdings?scope=p%3Ap1");
  });

  function renderHero(props: Record<string, unknown> = {}) {
    return render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NetWorthHistoryChart initial={initial} currency="IDR" variant="hero" {...props} />
      </NextIntlClientProvider>,
    );
  }

  it("writes ?range= with a shallow replace (no new history entry), keeping other params", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const lengthBefore = window.history.length;
    renderHero();
    fireEvent.click(screen.getByRole("radio", { name: "1M" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1m"));
    expect(window.location.search).toBe("?scope=p%3Ap1&range=1m");
    expect(replaceSpy).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(window.history.length).toBe(lengthBefore);
    push.mockRestore();
    replaceSpy.mockRestore();
  });

  it("removes the param again when the default range is picked", async () => {
    renderHero({ initialRange: "1m" });
    window.history.replaceState(null, "", "/holdings?range=1m");
    fireEvent.click(screen.getByRole("radio", { name: "1Y" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1y"));
    expect(window.location.search).toBe("");
  });

  it("opens on the server-resolved initialRange chip", () => {
    renderHero({ initialRange: "all" });
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
  });

  it("hides the 1D/7D chips when intraday data is absent", () => {
    renderHero({ hasIntraday: false });
    expect(screen.queryByRole("radio", { name: "1D" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "7D" })).not.toBeInTheDocument();
  });
});
