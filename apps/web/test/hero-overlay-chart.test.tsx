import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

// Stub recharts so jsdom's lack of layout doesn't suppress the line render.
// The hero chart relies on ResponsiveContainer's measured dimensions for the
// <Line> paths; in jsdom those never resolve, so the path is empty. Stubbing
// the chart wrapper lets us assert that the right <Line>s are passed the right
// dataKeys/strokes — which is the component's actual contract.
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
}));

import { HeroOverlayChart } from "../src/components/charts/hero-overlay-chart";

function renderChart(points: Array<{ date: string; portfolio: number; benchmark: number | null }>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <HeroOverlayChart points={points} />
    </NextIntlClientProvider>,
  );
}

describe("HeroOverlayChart", () => {
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
});
