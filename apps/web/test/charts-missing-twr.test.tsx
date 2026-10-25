import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { PerformancePoint } from "@portfolio/api-client";

/**
 * Audit E5 — a missing TWR percentage must not become a 0 %.
 *
 * On a base-100 chart a substituted 0 draws a cliff to zero (a −100 % move that never
 * happened). The series keeps the gap instead, so the line breaks where the value is
 * missing.
 */

// The recharts-backed chart is stubbed so the test can assert on the DATA the net-worth
// chart hands it (jsdom does not lay out a ResponsiveContainer, so there is no SVG to
// inspect).
const chartProps: Array<{ data: unknown[] }> = [];
vi.mock("@/components/charts/price-chart", () => ({
  PriceChart: (props: { data: unknown[] }) => {
    chartProps.push(props);
    return <div data-testid="chart" />;
  },
}));

const getNetWorthHistory = vi.fn(async (): Promise<PerformancePoint[]> => []);
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ getNetWorthHistory, getPortfolioHistory: getNetWorthHistory }),
}));

import { NetWorthHistoryChart } from "../src/components/charts/net-worth-history-chart";

function renderChart(initial: PerformancePoint[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NetWorthHistoryChart initial={initial} currency="EUR" />
    </NextIntlClientProvider>,
  );
}

describe("a missing TWR percentage is a gap, not a zero (audit E5)", () => {
  it("passes null for a missing pct (the line breaks) instead of 0", async () => {
    renderChart([
      { date: "2026-01-01", netWorth: "100", pct: "0" },
      { date: "2026-02-01", netWorth: "110" }, // no pct — the API has no TWR for this point
      { date: "2026-03-01", netWorth: "120", pct: "20" },
    ]);

    await screen.findByTestId("chart");
    fireEvent.click(screen.getByRole("radio", { name: "Performance" }));

    await waitFor(() => {
      const data = chartProps.at(-1)?.data as Array<{ date: string; close: unknown }>;
      expect(data.map((d) => d.close)).toEqual(["0", null, "20"]);
    });
    const data = chartProps.at(-1)?.data as Array<{ date: string; close: unknown }>;
    expect(data[1]?.close).not.toBe(0);
    expect(data[1]?.close).not.toBe("0");
  });
});
