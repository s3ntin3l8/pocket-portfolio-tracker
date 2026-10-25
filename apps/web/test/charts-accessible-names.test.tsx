import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import path from "node:path";
import messages from "../messages/en.json";
import { AllocationDonut } from "../src/components/charts/allocation-donut";
import { ContributionsChart } from "../src/components/charts/contributions-chart";
import { EpsActualEstimateChart } from "../src/components/charts/eps-actual-estimate-chart";
import { ForecastChart } from "../src/components/charts/forecast-chart";
import { HeroOverlayChart } from "../src/components/charts/hero-overlay-chart";
import { IncomeBarChart } from "../src/components/charts/income-bar-chart";
import { PriceChart } from "../src/components/charts/price-chart";
import { RevenueEarningsChart } from "../src/components/charts/revenue-earnings-chart";
import { YearlyReturnsCard } from "../src/components/insights/yearly-returns-card";

/**
 * Audit D1 — every chart is a NAMED graphic.
 *
 * recharts renders the chart's `title`/`desc` props into the SVG's `<title>`/`<desc>` and
 * defaults the SVG's role to `application` (which tells a screen reader to switch into
 * application mode for a graphic the user wants to READ). Every chart therefore passes a
 * localized title/desc and overrides the role with `img`.
 *
 * jsdom gives a ResponsiveContainer no size, so recharts would render nothing at all —
 * the container is stubbed with a fixed size here (the standard recharts test pattern).
 */
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  const react = await import("react");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement<{ width?: number; height?: number }>;
    }) => react.cloneElement(children, { width: 480, height: 240 }),
  };
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

function chartSvg(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg.recharts-surface");
  expect(svg, "the chart rendered an SVG surface").not.toBeNull();
  return svg as SVGSVGElement;
}

const charts: { name: string; render: () => HTMLElement; title: string }[] = [
  {
    name: "AllocationDonut",
    render: () =>
      render(
        wrap(
          <AllocationDonut
            currency="EUR"
            data={[
              { key: "equity", label: "Equity", value: 70 },
              { key: "cash", label: "Cash", value: 30 },
            ]}
          />,
        ),
      ).container,
    title: "Allocation chart",
  },
  {
    name: "ContributionsChart",
    render: () =>
      render(
        wrap(
          <ContributionsChart
            currency="EUR"
            series={[{ month: "2026-01", contributed: "1000" }]}
            dailySeries={[{ date: "2026-01-01", contributed: "1000" }]}
            valueHistory={[
              { date: "2026-01-01", netWorth: "1000" },
              { date: "2026-01-02", netWorth: "1100" },
            ]}
          />,
        ),
      ).container,
    title: "Contributions and portfolio value",
  },
  {
    name: "EpsActualEstimateChart",
    render: () =>
      render(
        wrap(
          <EpsActualEstimateChart
            data={[{ period: "1Q2026", actual: 1.2, estimate: 1.1 }]}
            currentQuarterEstimate={1.3}
          />,
        ),
      ).container,
    title: "Quarterly earnings per share",
  },
  {
    name: "ForecastChart",
    render: () =>
      render(
        wrap(
          <ForecastChart
            currency="EUR"
            presentValue="1000"
            series={[
              { monthIndex: 0, value: "1000", contributed: "0" },
              { monthIndex: 1, value: "1100", contributed: "100" },
            ]}
          />,
        ),
      ).container,
    title: "Savings forecast",
  },
  {
    name: "HeroOverlayChart",
    render: () =>
      render(
        wrap(
          <HeroOverlayChart
            currency="EUR"
            isIntraday={false}
            points={[
              { date: "2026-01-01", portfolio: 100, benchmark: 100 },
              { date: "2026-01-02", portfolio: 105, benchmark: 102 },
            ]}
          />,
        ),
      ).container,
    title: "Portfolio performance",
  },
  {
    name: "IncomeBarChart",
    render: () =>
      render(
        wrap(
          <IncomeBarChart
            currency="EUR"
            data={[
              { label: "2025", value: 100 },
              { label: "2026", value: 120 },
            ]}
          />,
        ),
      ).container,
    title: "Income per year",
  },
  {
    name: "PriceChart",
    render: () =>
      render(
        wrap(
          <PriceChart
            currency="EUR"
            data={[
              { date: "2026-01-01", close: "100" },
              { date: "2026-01-02", close: "105" },
            ]}
          />,
        ),
      ).container,
    title: "Price history",
  },
  {
    name: "RevenueEarningsChart",
    render: () =>
      render(
        wrap(
          <RevenueEarningsChart
            currency="EUR"
            data={[{ year: 2025, revenue: 1000, earnings: 120 }]}
          />,
        ),
      ).container,
    title: "Revenue and earnings",
  },
  {
    name: "YearlyReturnsCard",
    render: () =>
      render(
        wrap(
          <YearlyReturnsCard
            currency="EUR"
            locale="en"
            symbols={[]}
            rows={[
              {
                year: 2025,
                isCurrentYear: false,
                portfolioTwr: "0.12",
                portfolioXirr: "0.1",
                benchmarks: [],
              },
            ]}
          />,
        ),
      ).container,
    title: "Per-year returns",
  },
];

describe("every chart is a named graphic (audit D1)", () => {
  for (const chart of charts) {
    it(`${chart.name} exposes an accessible name and the img role`, () => {
      const svg = chartSvg(chart.render());

      // A name: the SVG's <title> (recharts renders the chart's `title` prop there).
      expect(svg.querySelector("title")?.textContent).toBe(chart.title);
      // A description: the SVG's <desc> names the series and the range.
      expect(svg.querySelector("desc")?.textContent?.trim()).not.toBe("");

      // The role: `img` (a graphic to READ), not recharts' `application` default (which
      // tells a screen reader to switch into application mode).
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("role")).not.toBe("application");
    });
  }
});

describe("chart focus is visible (audit D11)", () => {
  it("does not strip the focus ring from everything inside a chart", () => {
    const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    // The blanket rule (`.recharts-wrapper :focus`) removed the focus ring from the
    // chart surface — the focusable <svg> that drives the keyboard tooltip — and from
    // every other focusable element inside a chart.
    expect(css).not.toContain(".recharts-wrapper :focus");
    // Only the clickable pie sectors lose the default (box-shaped) ring …
    expect(css).toContain(".recharts-pie-sector:focus");
    // … and they get their own visible focus style.
    expect(css).toMatch(/recharts-pie-sector:focus[^{]*\{[^}]*stroke:\s*var\(--color-ring\)/);
  });
});

describe("the text equivalent of a chart's series (audit E8)", () => {
  it("the price chart exposes first/last/lowest/highest as text", () => {
    const { container } = render(
      wrap(
        <PriceChart
          currency="EUR"
          data={[
            { date: "2026-01-01", close: "100" },
            { date: "2026-01-02", close: "140" },
            { date: "2026-01-03", close: "90" },
          ]}
        />,
      ),
    );
    const summary = container.querySelector(".sr-only");
    expect(summary).not.toBeNull();
    const text = summary?.textContent ?? "";
    expect(text).toContain("First");
    expect(text).toContain("Last");
    expect(text).toContain("Lowest");
    expect(text).toContain("Highest");
    // €100.00 first, €90.00 last, €90.00 lowest, €140.00 highest
    expect(text).toContain("€100.00");
    expect(text).toContain("€140.00");
    expect(text).toContain("€90.00");
  });

  it("the hero chart exposes its series as text", () => {
    const { container } = render(
      wrap(
        <HeroOverlayChart
          currency="EUR"
          isIntraday={false}
          points={[
            { date: "2026-01-01", portfolio: 100, benchmark: 100 },
            { date: "2026-01-02", portfolio: 130, benchmark: 101 },
          ]}
        />,
      ),
    );
    const summary = container.querySelector(".sr-only");
    expect(summary?.textContent ?? "").toContain("Highest");
    expect(summary?.textContent ?? "").toContain("130.00%");
  });

  it("the forecast chart exposes its series as text", () => {
    const { container } = render(
      wrap(
        <ForecastChart
          currency="EUR"
          presentValue="1000"
          series={[
            { monthIndex: 0, value: "1000", contributed: "0" },
            { monthIndex: 1, value: "1500", contributed: "100" },
          ]}
        />,
      ),
    );
    const summary = container.querySelector(".sr-only");
    expect(summary?.textContent ?? "").toContain("Highest");
    expect(summary?.textContent ?? "").toContain("€1,500.00");
  });
});
