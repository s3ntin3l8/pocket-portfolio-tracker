import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import {
  DividendsTable,
  ByYearTable,
  IdIncomeTable,
  IdByYearTable,
} from "../src/components/tax/tax-tables";

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const CURRENCY = "IDR";
const LOCALE = "en";

describe("DividendsTable sorting", () => {
  it("sorts by Net descending on click", () => {
    wrap(
      <DividendsTable
        rows={[
          { symbol: "A", currency: "EUR", gross: "10", tax: "2", net: "8" },
          { symbol: "B", currency: "EUR", gross: "100", tax: "20", net: "80" },
        ]}
        totalsByCurrency={[{ currency: "EUR", gross: "110", tax: "22", net: "88" }]}
        locale="en"
        year={2026}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Net/i }));
    fireEvent.click(screen.getByRole("button", { name: /Net/i })); // second click = desc
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("B");
    expect(rows[1]).toHaveTextContent("A");
    expect(screen.getByRole("button", { name: /Net/i }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });
});

describe("ByYearTable sorting", () => {
  it("sorts by Year ascending on click (oldest first)", () => {
    wrap(
      <ByYearTable
        rows={[
          { year: 2026, realized: "240", dividends: "168", fsaUsed: "408", tax: "0" },
          { year: 2024, realized: "100", dividends: "227", fsaUsed: "327", tax: "0" },
        ]}
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Year/i }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("2024");
    expect(rows[1]).toHaveTextContent("2026");
  });
});

describe("IdIncomeTable sorting", () => {
  it("sorts by Gross descending on click", () => {
    const row = (symbol: string, gross: string, tax: string, net: string) => ({
      symbol,
      currency: "IDR",
      category: "domestic_dividend" as const,
      rate: "0.10",
      gross,
      tax,
      net,
      withheldAtSource: false,
      taxBasis: "estimated" as const,
      foreignTaxWithheld: null,
    });
    wrap(
      <IdIncomeTable
        rows={[row("BBCA", "100000", "10000", "90000"), row("BMRI", "500000", "50000", "450000")]}
        totalIncomeGross="600000"
        totalIncomeTax="60000"
        totalIncomeNet="540000"
        currency={CURRENCY}
        locale={LOCALE}
        year={2026}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Gross/i }));
    fireEvent.click(screen.getByRole("button", { name: /Gross/i }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("BMRI");
    expect(rows[1]).toHaveTextContent("BBCA");
  });
});

describe("ByYearTable basis note", () => {
  it("discloses that the selected year and earlier years use different bases", () => {
    wrap(
      <ByYearTable
        rows={[{ year: 2026, realized: "0", dividends: "168", fsaUsed: "168", tax: "0" }]}
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    expect(screen.getByText(messages.Tax.byYear.note)).toBeInTheDocument();
  });
});

describe("IdByYearTable sorting", () => {
  it("sorts by Tax descending on click", () => {
    wrap(
      <IdByYearTable
        rows={[
          {
            year: 2025,
            realized: "1940000",
            income: "2110000",
            foreignIncome: "0",
            tax: "212940",
          },
          {
            year: 2026,
            realized: "324000",
            income: "1284000",
            foreignIncome: "0",
            tax: "128724",
          },
        ]}
        currency={CURRENCY}
        locale={LOCALE}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Tax/i }));
    fireEvent.click(screen.getByRole("button", { name: /Tax/i }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("2025");
    expect(rows[1]).toHaveTextContent("2026");
  });
});
