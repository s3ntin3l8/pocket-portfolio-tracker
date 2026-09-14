import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HeroOverlayPoint } from "../src/components/charts/hero-overlay-chart";

// Stub recharts so jsdom's lack of layout doesn't suppress the line render.
// The hero chart relies on ResponsiveContainer's measured dimensions for the
// <Line> paths; in jsdom those never resolve, so the path is empty. Stubbing
// the chart wrapper lets us assert that the right <Line>s are passed the right
// dataKeys/strokes — which is the component's actual contract.
//
// The <Tooltip> stub renders its `content` prop (the real HeroTooltip component)
// so we can exercise the hook-driven tooltip rendering in the tests below.
// useIsTooltipActive / useActiveTooltipDataPoints are controllable via
// vi.mocked() between tests to drive the tooltip open with fixture data.
let _isTooltipActive = false;
let _activeTooltipDataPoints: HeroOverlayPoint[] | undefined;

vi.mock("recharts", () => ({
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: ({
    dataKey,
    stroke,
    strokeDasharray,
  }: {
    dataKey: string;
    stroke: string;
    strokeDasharray?: string;
  }) => (
    <div data-testid={`line-${dataKey}`} data-stroke={stroke} data-dash={strokeDasharray ?? ""} />
  ),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ content }: { content?: React.ReactNode }) => (
    <div data-testid="tooltip-stub">{content}</div>
  ),
  useIsTooltipActive: () => _isTooltipActive,
  useActiveTooltipDataPoints: () => _activeTooltipDataPoints,
}));

import { HeroOverlayChart } from "../src/components/charts/hero-overlay-chart";

function renderChart(points: Array<HeroOverlayPoint>, opts: { isIntraday?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HeroOverlayChart points={points} isIntraday={opts.isIntraday ?? false} currency="USD" />
    </NextIntlClientProvider>,
  );
}

describe("HeroOverlayChart", () => {
  beforeEach(() => {
    _isTooltipActive = false;
    _activeTooltipDataPoints = undefined;
  });

  it("renders without crashing when given a 2-point portfolio-only series", () => {
    renderChart([
      { date: "2026-01-01", portfolio: 100, benchmark: null },
      { date: "2026-02-01", portfolio: 110, benchmark: null },
    ]);
    expect(screen.getByTestId("hero-overlay-chart")).toBeInTheDocument();
  });

  it("renders two <Line>s — portfolio (white) + benchmark (yellow dashed)", () => {
    renderChart([
      { date: "2026-01-01", portfolio: 100, benchmark: 100 },
      { date: "2026-02-01", portfolio: 110, benchmark: 105 },
      { date: "2026-03-01", portfolio: 120, benchmark: 108 },
    ]);
    const portfolioLine = screen.getByTestId("line-portfolio");
    const benchmarkLine = screen.getByTestId("line-benchmark");
    expect(portfolioLine).toHaveAttribute("data-stroke", "#ffffff");
    expect(portfolioLine).toHaveAttribute("data-dash", "");
    expect(benchmarkLine).toHaveAttribute("data-stroke", "#FFD24A");
    expect(benchmarkLine).toHaveAttribute("data-dash", "5 3");
  });

  it("renders no tooltip panel when tooltip is inactive", () => {
    _isTooltipActive = false;
    renderChart([
      { date: "2026-01-01", portfolio: 100, benchmark: 100 },
      { date: "2026-02-01", portfolio: 110, benchmark: 105 },
    ]);
    expect(screen.getByTestId("tooltip-stub")).toBeEmptyDOMElement();
  });

  it("renders tooltip panel with date + portfolio row for a day-grained point (no benchmark)", () => {
    _isTooltipActive = true;
    _activeTooltipDataPoints = [{ date: "2026-03-15", portfolio: 105.42, benchmark: null }];
    renderChart([{ date: "2026-03-15", portfolio: 105.42, benchmark: null }]);
    // Date formatted as "Mar 15, 2026" (en-US locale in jsdom)
    expect(screen.getByText("Mar 15, 2026")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    // TWR % for day-grained: formatPercent(105.42 / 100)
    expect(screen.getByText("+105.42%")).toBeInTheDocument();
    // No benchmark row
    expect(screen.queryByText("Benchmark")).not.toBeInTheDocument();
  });

  it("renders tooltip panel with date + portfolio + benchmark rows for a day-grained point", () => {
    _isTooltipActive = true;
    _activeTooltipDataPoints = [{ date: "2026-06-01", portfolio: 112.5, benchmark: 98.3 }];
    renderChart([{ date: "2026-06-01", portfolio: 112.5, benchmark: 98.3 }]);
    expect(screen.getByText("Jun 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(screen.getByText("+112.50%")).toBeInTheDocument();
    expect(screen.getByText("Benchmark")).toBeInTheDocument();
    expect(screen.getByText("+98.30%")).toBeInTheDocument();
  });

  it("renders tooltip with intraday label and currency values for intraday range", () => {
    _isTooltipActive = true;
    _activeTooltipDataPoints = [{ date: "14:30", portfolio: 15234.56, benchmark: null }];
    renderChart([{ date: "14:30", portfolio: 15234.56, benchmark: null }], {
      isIntraday: true,
    });
    // Intraday label passes through as-is
    expect(screen.getByText("14:30")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    // Currency-formatted (USD) — at least contains the amount
    expect(screen.getByText(/\$15,234\.56/)).toBeInTheDocument();
    expect(screen.queryByText("Benchmark")).not.toBeInTheDocument();
  });

  it("renders tooltip with both rows on intraday range when benchmark present", () => {
    _isTooltipActive = true;
    _activeTooltipDataPoints = [{ date: "3 Jul", portfolio: 16000, benchmark: 15800 }];
    renderChart([{ date: "3 Jul", portfolio: 16000, benchmark: 15800 }], {
      isIntraday: true,
    });
    expect(screen.getByText("3 Jul")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(screen.getByText("Benchmark")).toBeInTheDocument();
    expect(screen.getByText(/\$16,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$15,800\.00/)).toBeInTheDocument();
  });
});
