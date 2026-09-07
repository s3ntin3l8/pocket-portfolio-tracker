import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { YearlyReturnsCard } from "../src/components/insights/yearly-returns-card";
import type { BenchmarkSymbolEntry, YearlyReturnRow } from "@portfolio/api-client";
import messages from "../messages/en.json";

const symbols: BenchmarkSymbolEntry[] = [
  { symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 },
];

const rows: YearlyReturnRow[] = [
  {
    year: 2023,
    isCurrentYear: false,
    portfolioTwr: "0.12",
    portfolioXirr: "0.115",
    benchmarks: [
      {
        symbol: "^GSPC",
        displayName: "S&P 500",
        nativeCurrency: "USD",
        twr: "0.16",
        activeReturn: "-0.04",
      },
    ],
  },
  {
    year: 2024,
    isCurrentYear: true,
    portfolioTwr: "0.05",
    portfolioXirr: "0.048",
    benchmarks: [
      {
        symbol: "^GSPC",
        displayName: "S&P 500",
        nativeCurrency: "USD",
        twr: "0.02",
        activeReturn: "0.03",
      },
    ],
  },
];

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <YearlyReturnsCard rows={rows} symbols={symbols} currency="USD" locale="en" />
    </NextIntlClientProvider>,
  );
}

describe("YearlyReturnsCard", () => {
  it("renders a row per year with portfolio and benchmark columns", () => {
    renderCard();
    // Header row
    expect(screen.getByText("Year")).toBeInTheDocument();
    expect(screen.getByText("Portfolio TWR")).toBeInTheDocument();
    expect(screen.getByText("Portfolio XIRR")).toBeInTheDocument();
    // Body rows
    expect(screen.getByText("2023")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("tags the current year with a YTD suffix", () => {
    renderCard();
    const ytd = screen.getByText(/YTD/);
    expect(ytd).toBeInTheDocument();
  });

  it("renders an em-dash for null benchmark cells (no crash, no NaN)", () => {
    const sparse: YearlyReturnRow[] = [
      {
        year: 2024,
        isCurrentYear: true,
        portfolioTwr: "0.05",
        portfolioXirr: null,
        benchmarks: [
          {
            symbol: "^GSPC",
            displayName: "S&P 500",
            nativeCurrency: "USD",
            twr: null,
            activeReturn: null,
          },
        ],
      },
    ];
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <YearlyReturnsCard rows={sparse} symbols={symbols} currency="USD" locale="en" />
      </NextIntlClientProvider>,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("renders nothing chart-related when the rows array is empty (insufficient-data state)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <YearlyReturnsCard rows={[]} symbols={symbols} currency="USD" locale="en" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Not enough data/i)).toBeInTheDocument();
  });
});
