import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { AllocationDonut } from "../src/components/charts/allocation-donut";

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

describe("AllocationDonut (audit G2/G3)", () => {
  it("prints the server pct when given, so every surface shows the same weight", () => {
    render(
      wrap(
        <AllocationDonut
          currency="EUR"
          data={[
            { key: "equity", label: "Equity", value: 70, actualPct: 70 },
            { key: "cash", label: "Cash", value: 30, actualPct: 28.8 },
          ]}
        />,
      ),
    );
    expect(screen.getByText("28.8%")).toBeInTheDocument();
    expect(screen.queryByText("30.0%")).not.toBeInTheDocument();
  });

  it("falls back to value / sum when no server pct is given", () => {
    render(
      wrap(
        <AllocationDonut
          currency="EUR"
          data={[
            { key: "equity", label: "Equity", value: 75 },
            { key: "cash", label: "Cash", value: 25 },
          ]}
        />,
      ),
    );
    expect(screen.getByText("25.0%")).toBeInTheDocument();
  });

  it("shows the hatched at-cost legend note only when a slice has an at-cost share", () => {
    const { rerender } = render(
      wrap(
        <AllocationDonut
          currency="EUR"
          atCostLegend="Hatched: valued at cost"
          data={[{ key: "equity", label: "Equity", value: 100, atCostValue: 40 }]}
        />,
      ),
    );
    expect(screen.getByText("Hatched: valued at cost")).toBeInTheDocument();
    rerender(
      wrap(
        <AllocationDonut
          currency="EUR"
          atCostLegend="Hatched: valued at cost"
          data={[{ key: "equity", label: "Equity", value: 100 }]}
        />,
      ),
    );
    expect(screen.queryByText("Hatched: valued at cost")).not.toBeInTheDocument();
  });
});
