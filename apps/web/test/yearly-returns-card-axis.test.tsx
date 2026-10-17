import { cloneElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BenchmarkSymbolEntry, YearlyReturnRow } from "@portfolio/api-client";
import { YearlyReturnsCard } from "../src/components/insights/yearly-returns-card";
import messages from "../messages/en.json";

// jsdom can't measure text, so the sizing contract (not a pixel width) is what can be
// asserted: capture the Y axis props, and give the chart a size so it renders its axes.
const yAxisProps: Array<{ width?: number | "auto"; tickFormatter?: (v: number) => string }> = [];
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 400, height: 200 } as object),
    YAxis: (props: (typeof yAxisProps)[number]) => {
      yAxisProps.push(props);
      return null;
    },
  };
});

const symbols: BenchmarkSymbolEntry[] = [
  { symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 },
];
const rows: YearlyReturnRow[] = [
  {
    year: 2023,
    isCurrentYear: false,
    portfolioTwr: "-0.2",
    portfolioXirr: "-0.19",
    benchmarks: [
      {
        symbol: "^GSPC",
        displayName: "S&P 500",
        nativeCurrency: "USD",
        twr: "0.3",
        activeReturn: "-0.5",
      },
    ],
  },
];

describe("YearlyReturnsCard Y axis (#1019)", () => {
  it("sizes the axis to its tick labels so signed two-digit ticks are not clipped", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <YearlyReturnsCard rows={rows} symbols={symbols} currency="USD" locale="en" />
      </NextIntlClientProvider>,
    );
    const axis = yAxisProps.at(-1);
    expect(axis?.width).toBe("auto");
    expect(axis?.tickFormatter?.(-20)).toBe("-20%");
    expect(axis?.tickFormatter?.(30)).toBe("30%");
  });
});
