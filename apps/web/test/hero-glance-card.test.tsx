import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HistoryPoint } from "@portfolio/api-client";

vi.mock("@/components/charts/price-chart", () => ({
  PriceChart: () => <div data-testid="chart" />,
}));
vi.mock("@/components/charts/hero-overlay-chart", () => ({
  HeroOverlayChart: () => <div data-testid="hero-overlay-chart" />,
}));
const getNetWorthHistory = vi.fn(async (): Promise<HistoryPoint[]> => []);
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ getNetWorthHistory }),
}));

import { HeroGlanceCard } from "../src/components/holdings/hero-glance-card";

const initialWithBenchmark: HistoryPoint[] = [
  { date: "2026-07-01", netWorth: "900000", marketValue: "900000", pct: "0", benchmarkPct: "0" },
  { date: "2026-07-29", netWorth: "990000", marketValue: "990000", pct: "10", benchmarkPct: "8" },
];

const initialWithoutBenchmark: HistoryPoint[] = [
  { date: "2026-07-01", netWorth: "900000", marketValue: "900000", pct: "0" },
  { date: "2026-07-29", netWorth: "990000", marketValue: "990000", pct: "10" },
];

describe("HeroGlanceCard", () => {
  it("shows the static current net worth headline regardless of the chart range", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1m"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Total portfolio value")).toBeInTheDocument();
    expect(screen.getByText(/IDR\s*1,050,000/)).toBeInTheDocument();
  });

  it("derives pill 1 from TWR pct (not absolute currency delta) and adds pill 2 from benchmark", () => {
    // Seeded with portfolio pct 0 → 10 (pill 1 reads +10%) and benchmark pct 0 → 8
    // (pill 2 reads +8% vs S&P 500).
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1m"
        />
      </NextIntlClientProvider>,
    );
    // Pill 1: portfolio TWR % + period word.
    expect(screen.getByText(/past 1M/)).toBeInTheDocument();
    expect(screen.getByText(/10\.00%/)).toBeInTheDocument();
    // Pill 2: benchmark prefix from Insights.benchmark.vs + benchmark %.
    expect(screen.getByText(/vs S&P 500/)).toBeInTheDocument();
    expect(screen.getByText(/8\.00%/)).toBeInTheDocument();
  });

  it("hides pill 2's value and shows a fallback '—' when the chart emits hasBenchmark=false", () => {
    // No benchmarkPct on any point — chart will emit hasBenchmark=false.
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithoutBenchmark}
          initialRange="1m"
        />
      </NextIntlClientProvider>,
    );
    // The Insights.benchmark.vs label still appears (so the user sees which symbol is
    // being compared against), but the value is a placeholder em-dash. The em-dash
    // is one of several text fragments inside the same pill span (separated by an
    // inter-element space text node), so we use a function matcher against the
    // node's `textContent` rather than a string match.
    expect(screen.getByText(/past 1M/)).toBeInTheDocument();
    const pill2 = screen.getByText(/vs S&P 500/).parentElement as HTMLElement;
    expect(pill2.textContent).toContain("vs S&P 500");
    expect(pill2.textContent).toContain("—");
  });

  it("hides both pills when fewer than 2 series points are available", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard netWorth="0" currency="IDR" initialHistory={[]} initialRange="7d" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/▲/)).not.toBeInTheDocument();
    expect(screen.queryByText(/▼/)).not.toBeInTheDocument();
    expect(screen.queryByText(/past/)).not.toBeInTheDocument();
  });
});
