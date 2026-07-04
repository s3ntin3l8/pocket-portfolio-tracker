import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { AllocationCard } from "../src/components/holdings/allocation-card";
import { RegionCurrencyCard } from "../src/components/holdings/region-currency-card";

function withIntl(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("AllocationCard", () => {
  it("renders the title and the desktop-only totals column", () => {
    render(
      withIntl(
        <AllocationCard
          title="Allocation"
          slices={[
            { key: "equity", label: "Stocks", value: 700 },
            { key: "gold", label: "Gold", value: 300 },
          ]}
          currency="IDR"
          total={1000}
          totalLabel="Total value"
          totalValueFormatted="Rp 1.000.000"
          allTimeLabel="All-time"
          allTimePct="+12.0%"
          todayLabel="Today"
          todayAmount="+Rp 5.000"
        />,
      ),
    );
    expect(screen.getByText("Allocation")).toBeInTheDocument();
    expect(screen.getByText("Total value")).toBeInTheDocument();
    expect(screen.getByText("Rp 1.000.000")).toBeInTheDocument();
    expect(screen.getByText("+12.0%")).toBeInTheDocument();
    expect(screen.getByText("+Rp 5.000")).toBeInTheDocument();
  });

  it("falls back to a dash when allTimePct is null", () => {
    render(
      withIntl(
        <AllocationCard
          title="Allocation"
          slices={[{ key: "equity", label: "Stocks", value: 1 }]}
          currency="IDR"
          total={1}
          totalLabel="Total value"
          totalValueFormatted="Rp 1"
          allTimeLabel="All-time"
          allTimePct={null}
          todayLabel="Today"
          todayAmount="Rp 0"
        />,
      ),
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("RegionCurrencyCard", () => {
  it("renders both columns with their rows", () => {
    render(
      <RegionCurrencyCard
        regionTitle="By region"
        currencyTitle="By currency"
        regionRows={[
          { key: "Asia", label: "Asia", pct: 62.4 },
          { key: "Europe", label: "Europe", pct: 37.6 },
        ]}
        currencyRows={[{ key: "IDR", label: "IDR", pct: 100 }]}
      />,
    );
    expect(screen.getByText("By region")).toBeInTheDocument();
    expect(screen.getByText("By currency")).toBeInTheDocument();
    expect(screen.getByText("Asia")).toBeInTheDocument();
    expect(screen.getByText("62.4%")).toBeInTheDocument();
    expect(screen.getByText("IDR")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("shows a dash placeholder for an empty column", () => {
    render(
      <RegionCurrencyCard
        regionTitle="By region"
        currencyTitle="By currency"
        regionRows={[]}
        currencyRows={[{ key: "IDR", label: "IDR", pct: 100 }]}
      />,
    );
    expect(screen.getAllByText("—")).toHaveLength(1);
  });
});
