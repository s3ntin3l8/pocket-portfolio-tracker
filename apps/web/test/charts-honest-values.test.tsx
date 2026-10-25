import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messagesEn from "../messages/en.json";
import messagesId from "../messages/id.json";
import { AllocationDonut } from "../src/components/charts/allocation-donut";
import { ContributionsChart } from "../src/components/charts/contributions-chart";
import { PriceChart } from "../src/components/charts/price-chart";
import { formatMoneyCompact } from "../src/lib/utils";

/**
 * Audit E4/E5/E6a/E7 — the charts' numbers must be the real ones.
 *
 * - E4: the contributions chart gets a value axis (money ticks + the currency) and its
 *   value line is toned by the sign of the gain instead of a hard-coded green.
 * - E5: a missing value breaks the line — it is never substituted with 0.
 * - E6a: percent labels go through the canonical `formatPercentPoints` (locale-correct).
 * - E7: the donut uses the app's one compact-money formatter.
 */

// jsdom gives a ResponsiveContainer no size, so recharts would render nothing at all —
// the container is stubbed with a fixed size here (the standard recharts test pattern).
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

const wrap = (ui: React.ReactNode, locale: "en" | "id" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? messagesEn : messagesId}>
    {ui}
  </NextIntlClientProvider>
);

function paths(container: HTMLElement) {
  return [...container.querySelectorAll("path")].map((p) => p.getAttribute("d") ?? "");
}

/** How many separate sub-paths a rendered path has (a broken line has more than one). */
function subPaths(d: string): number {
  return (d.match(/M/g) ?? []).length;
}

describe("contributions chart — a value axis and a sign-aware value line (audit E4)", () => {
  function renderContributions(netWorth: string[]) {
    return render(
      wrap(
        <ContributionsChart
          currency="EUR"
          series={[{ month: "2026-01", contributed: "1000" }]}
          // The daily contributions are cumulative: the first day carries the deposit, the
          // rest add nothing (so "invested" stays 1000 and the gain is the value minus it).
          dailySeries={netWorth.map((_, i) => ({
            date: `2026-01-0${i + 1}`,
            contributed: i === 0 ? "1000" : "0",
          }))}
          valueHistory={netWorth.map((v, i) => ({ date: `2026-01-0${i + 1}`, netWorth: v }))}
        />,
      ),
    );
  }

  it("labels the value axis with money and names the currency", () => {
    const { container } = renderContributions(["1000", "1100"]);
    const svg = container.querySelector("svg.recharts-surface");
    const ticks = [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
      (t) => t.textContent,
    );
    // The value axis carries money (not a bare number) …
    expect(ticks.some((t) => t?.includes("€"))).toBe(true);
    // … and the axis itself names the currency.
    expect(svg?.textContent).toContain("EUR");
  });

  it("draws the value line in the loss tone when the portfolio is underwater", () => {
    const { container } = renderContributions(["900", "800"]);
    const strokes = [...container.querySelectorAll("path")].map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain("var(--color-destructive)");
    expect(strokes).not.toContain("var(--color-success)");
  });

  it("draws the value line in the gain tone when the portfolio is above cost", () => {
    const { container } = renderContributions(["1100", "1200"]);
    const strokes = [...container.querySelectorAll("path")].map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain("var(--color-success)");
    expect(strokes).not.toContain("var(--color-destructive)");
  });
});

describe("a missing value breaks the line instead of dropping to zero (audit E5)", () => {
  it("leaves a gap where the value is missing", () => {
    const { container } = render(
      wrap(
        <PriceChart
          currency="EUR"
          data={[
            { date: "d1", close: "100" },
            { date: "d2", close: null },
            { date: "d3", close: "120" },
          ]}
        />,
      ),
    );
    // The area is drawn as two sub-paths: the line breaks at the missing point.
    expect(Math.max(...paths(container).map(subPaths))).toBeGreaterThan(1);
  });

  it("draws a real zero as a continuous line (a zero is a value, a gap is not)", () => {
    const { container } = render(
      wrap(
        <PriceChart
          currency="EUR"
          data={[
            { date: "d1", close: "100" },
            { date: "d2", close: "0" },
            { date: "d3", close: "120" },
          ]}
        />,
      ),
    );
    expect(Math.max(...paths(container).map(subPaths))).toBe(1);
  });
});

describe("percent labels use the canonical formatter (audit E6a)", () => {
  function axisTicks(locale: "en" | "id") {
    const { container } = render(
      wrap(
        <PriceChart
          currency="EUR"
          unit="percent"
          data={[
            { date: "d1", close: "12.5" },
            { date: "d2", close: "18.75" },
          ]}
        />,
        locale,
      ),
    );
    return [...container.querySelectorAll(".recharts-cartesian-axis-tick-value")].map(
      (t) => t.textContent ?? "",
    );
  }

  it("formats the percent axis for the English locale", () => {
    const ticks = axisTicks("en");
    expect(ticks.some((t) => t.includes("15.00%"))).toBe(true);
    expect(ticks.some((t) => t.includes("15,00%"))).toBe(false);
  });

  it("formats the percent axis for the Indonesian locale", () => {
    const ticks = axisTicks("id");
    expect(ticks.some((t) => t.includes("15,00%"))).toBe(true);
    expect(ticks.some((t) => t.includes("15.00%"))).toBe(false);
  });
});

describe("the allocation donut uses the app's compact-money formatter (audit E7)", () => {
  it("prints the canonical compact amount in the legend", () => {
    const { container } = render(
      wrap(
        <AllocationDonut
          currency="EUR"
          data={[
            { key: "equity", label: "Equity", value: 1_200_000 },
            { key: "cash", label: "Cash", value: 300_000 },
          ]}
        />,
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain(formatMoneyCompact(1_200_000, "EUR", "en"));
    expect(text).toContain(formatMoneyCompact(300_000, "EUR", "en"));
  });
});
