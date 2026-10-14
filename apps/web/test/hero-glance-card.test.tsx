import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

import { formatNetWorth } from "../src/lib/utils";
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

  it("shows an at-cost count that links to the filtered Holdings list (audit G3)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1m"
          atCostCount={2}
          atCostHref="/holdings?filter=at-cost"
        />
      </NextIntlClientProvider>,
    );
    const link = screen.getByRole("link", { name: /2 holdings at cost/i });
    expect(link).toHaveTextContent("2 holdings at cost");
    expect(link.getAttribute("href")).toContain("filter=at-cost");
    expect(screen.queryByText(/Includes one or more/)).not.toBeInTheDocument();
  });

  it("combines at-cost and no-FX counts, singular and plural", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1m"
          atCostCount={1}
          fxMissingCount={3}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link")).toHaveTextContent(
      "1 holding at cost · 3 holdings without FX rate",
    );
  });

  it("prints the net worth with the shared formatter (same string the sidebar uses)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="39044.83"
          currency="EUR"
          initialHistory={initialWithBenchmark}
          initialRange="1m"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(formatNetWorth("39044.83", "EUR", "en"))).toBeInTheDocument();
    expect(screen.getByText("€39,044.83")).toBeInTheDocument();
  });

  it("omits the count when every holding is normally priced", () => {
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
    expect(screen.queryByText(/at cost/)).not.toBeInTheDocument();
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

  it("renders pill 1 as a currency delta (not a percent) on intraday 1D/7D ranges", async () => {
    // Intraday points carry absolute currency values. The hero card must
    // format pill 1 as a currency delta (e.g. "▲ IDR 50,000"), not as a percent
    // (which would render a nonsense 50,000% for a 50k move on a 1M base).
    // Start on 7D so the 1D click triggers a real fetch (the chart is a no-op
    // when the clicked range already matches the current range).
    getNetWorthHistory.mockResolvedValueOnce([
      {
        at: "2026-09-07T01:00:00.000Z",
        netWorth: "1000000",
        marketValue: "1000000",
      },
      {
        at: "2026-09-07T05:00:00.000Z",
        netWorth: "1050000",
        marketValue: "1050000",
      },
    ]);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard netWorth="1050000" currency="IDR" initialHistory={[]} initialRange="7d" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "1D" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1d"));
    await waitFor(() => expect(screen.getByText(/past 1D/)).toBeInTheDocument());
    // Pill 1 shows the absolute currency delta (50,000 IDR) — NOT a percent.
    expect(screen.getByText(/IDR\s*50,000/)).toBeInTheDocument();
    // And does not show a "50,000%" or "10,000%" style percent (the bug).
    expect(screen.queryByText(/50,?000\.00%|10,?000\.00%/)).not.toBeInTheDocument();
  });

  it("re-renders the pills for the new range inside a transition and leaves the headline and history alone", async () => {
    getNetWorthHistory.mockResolvedValueOnce([
      {
        date: "2026-07-22",
        netWorth: "950000",
        marketValue: "950000",
        pct: "0",
        benchmarkPct: "0",
      },
      {
        date: "2026-07-29",
        netWorth: "990000",
        marketValue: "990000",
        pct: "3",
        benchmarkPct: "1",
      },
    ]);
    const historyLen = window.history.length;
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
    const headline = screen.getByText(/IDR\s*1,050,000/);
    expect(screen.getByText(/past 1M/)).toHaveTextContent("10.00%");

    fireEvent.click(screen.getByRole("radio", { name: "1Y" }));
    await waitFor(() => expect(getNetWorthHistory).toHaveBeenCalledWith("1y"));
    await waitFor(() => expect(screen.getByText(/past 1Y/)).toHaveTextContent("3.00%"));
    expect(screen.queryByText(/past 1M/)).not.toBeInTheDocument();
    expect(screen.getByText(/vs S&P 500/)).toHaveTextContent("1.00%");
    // Headline is the very same node, untouched; a range click adds no history entry.
    expect(screen.getByText(/IDR\s*1,050,000/)).toBe(headline);
    expect(window.history.length).toBe(historyLen);
  });

  it("uses the configured benchmark symbol for the pill + legend (not the ^GSPC default)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1m"
          benchmarkSymbol="^IXIC"
        />
      </NextIntlClientProvider>,
    );
    // The friendly label for ^IXIC (Nasdaq Composite) appears twice: once in
    // the pill 2 prefix "vs Nasdaq Composite" and once in the legend. The
    // default ^GSPC label (S&P 500) should not appear anywhere — the previous
    // hardcoded value would have leaked here.
    expect(screen.getAllByText(/Nasdaq Composite/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/S&P 500/)).not.toBeInTheDocument();
  });

  it("hides the 1D/7D chips until intraday data exists (audit G8)", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1y"
          hasIntraday={false}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("radio", { name: "1D" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "7D" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "1M" })).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1y"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("radio", { name: "1D" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "7D" })).toBeInTheDocument();
  });

  it("keeps the 1D/7D chips when the intraday check itself failed", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <HeroGlanceCard
          netWorth="1050000"
          currency="IDR"
          initialHistory={initialWithBenchmark}
          initialRange="1y"
          hasIntraday="unavailable"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("radio", { name: "1D" })).toBeInTheDocument();
  });
});
