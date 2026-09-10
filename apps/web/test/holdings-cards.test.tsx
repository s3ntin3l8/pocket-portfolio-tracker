import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { AllocationCard } from "../src/components/holdings/allocation-card";
import { PortfolioValueCard } from "../src/components/holdings/portfolio-value-card";
import { RegionCurrencyCard } from "../src/components/holdings/region-currency-card";

function withIntl(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

describe("PortfolioValueCard", () => {
  it("renders total value, all-time and today stats", () => {
    render(
      withIntl(
        <PortfolioValueCard
          totalLabel="Total value"
          totalValueFormatted="Rp 1.000.000"
          allTimeLabel="All-time"
          allTimeAmount="+Rp 120.000"
          allTimePct="+12.0%"
          allTimeTone="up"
          todayLabel="Today"
          todayAmount="+Rp 5.000"
          todayPct="+0.5%"
          todayTone="up"
        />,
      ),
    );
    expect(screen.getByText("Total value")).toBeInTheDocument();
    expect(screen.getByText("Rp 1.000.000")).toBeInTheDocument();
    expect(screen.getByText("+Rp 120.000")).toBeInTheDocument();
    expect(screen.getByText("+12.0%")).toBeInTheDocument();
    expect(screen.getByText("+Rp 5.000")).toBeInTheDocument();
    expect(screen.getByText("+0.5%")).toBeInTheDocument();
  });

  it("omits the % line when a percent is null but still shows the amount", () => {
    render(
      withIntl(
        <PortfolioValueCard
          totalLabel="Total value"
          totalValueFormatted="Rp 1"
          allTimeLabel="All-time"
          allTimeAmount="Rp 0"
          allTimePct={null}
          todayLabel="Today"
          todayAmount="Rp 0"
          todayPct={null}
        />,
      ),
    );
    expect(screen.getAllByText("Rp 0").length).toBeGreaterThan(0);
    expect(screen.queryByText("%")).toBeNull();
  });
});

describe("AllocationCard", () => {
  it("renders the donut legend items", () => {
    render(
      withIntl(
        <AllocationCard
          slices={[
            { key: "equity", label: "Stocks", value: 700 },
            { key: "gold", label: "Gold", value: 300 },
          ]}
          currency="IDR"
          total={1000}
        />,
      ),
    );
    expect(screen.getByText("Stocks")).toBeInTheDocument();
    expect(screen.getByText("Gold")).toBeInTheDocument();
  });
});

describe("RegionCurrencyCard", () => {
  it("renders both sections with their rows", () => {
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
