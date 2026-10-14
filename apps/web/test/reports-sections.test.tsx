import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    const bag = (messages as unknown as Record<string, Record<string, string>>)[ns] ?? {};
    return (key: string, vals?: Record<string, unknown>) => {
      const v = bag[key] ?? key;
      return vals ? `${v}${JSON.stringify(vals)}` : v;
    };
  },
}));

const data = vi.hoisted(() => ({
  incomeReport: vi.fn(),
  tradesReport: vi.fn(),
  contributionsReport: vi.fn(),
  goldReport: vi.fn(),
  taxReport: vi.fn(),
  taxRegimeOf: vi.fn(),
  taxIdDetailReport: vi.fn(),
  taxDocumentsReport: vi.fn(),
}));
vi.mock("@/components/reports/reports-data", () => data);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

vi.mock("@/components/reports/report-card", () => ({
  ReportCard: (p: { title: string; value: string; href: string }) => (
    <a href={p.href} data-testid="card">
      {p.title}={p.value}
    </a>
  ),
}));

import {
  IncomeCard,
  TradesCard,
  SavingsCard,
  TaxCard,
  GoldCard,
  DocumentsCard,
} from "../src/components/reports/reports-cards";
import { ReportsStatus } from "../src/components/reports/reports-status";

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

const ok = (extra: object = {}) => ({
  status: "ok" as const,
  data: { displayCurrency: "EUR", ...extra },
});

beforeEach(() => {
  for (const fn of Object.values(data)) fn.mockReset();
  data.taxRegimeOf.mockResolvedValue("DE");
  data.taxIdDetailReport.mockResolvedValue(null);
  data.taxDocumentsReport.mockResolvedValue([]);
});

describe("Reports cards", () => {
  it("each data card renders nothing when its source failed or is empty", async () => {
    data.incomeReport.mockResolvedValue({ status: "unavailable" });
    data.tradesReport.mockResolvedValue(ok({ trades: [] }));
    data.contributionsReport.mockResolvedValue({ status: "empty" });
    data.taxReport.mockResolvedValue({ status: "empty" });
    data.goldReport.mockResolvedValue(ok({ holdings: [], plans: [] }));
    expect(await IncomeCard({ locale: "en" })).toBeNull();
    expect(await TradesCard({ locale: "en" })).toBeNull();
    expect(await SavingsCard({ locale: "en" })).toBeNull();
    expect(await TaxCard({ locale: "en" })).toBeNull();
    expect(await GoldCard({ locale: "en" })).toBeNull();
  });

  it("income card renders its headline and links to /income", async () => {
    data.incomeReport.mockResolvedValue(
      ok({
        thisYear: "100",
        lastYear: "50",
        forecastFullYear: "200",
        ttm: "120",
        lifetimeTotal: "500",
      }),
    );
    wrap(await IncomeCard({ locale: "en" }));
    expect(screen.getByTestId("card")).toHaveAttribute("href", "/income");
    expect(screen.getByTestId("card").textContent).toContain("100");
  });

  it("DE tax card uses the allowance usage sums", async () => {
    data.taxReport.mockResolvedValue({
      status: "ok",
      holders: [
        {
          currency: "EUR",
          allowanceUsage: {
            usedYtd: "300",
            allowanceAnnual: "1000",
            realizedGainsAdjusted: "10",
            incomeYtd: "5",
          },
        },
      ],
    });
    wrap(await TaxCard({ locale: "en" }));
    expect(screen.getByTestId("card")).toHaveAttribute("href", "/tax");
    expect(screen.getByTestId("card").textContent).toContain("300");
  });

  it("ID tax card aggregates the per-holder final-tax breakdown", async () => {
    data.taxRegimeOf.mockResolvedValue("ID");
    data.taxReport.mockResolvedValue({
      status: "ok",
      holders: [{ holder: { id: "h1" }, currency: "IDR" }],
    });
    data.taxIdDetailReport.mockResolvedValue(
      new Map([
        [
          "h1",
          {
            indonesianFinalTax: {
              estimatedTax: "1000",
              totalProceeds: "2000",
              totalDividendGross: "3000",
            },
          },
        ],
      ]),
    );
    wrap(await TaxCard({ locale: "en" }));
    expect(screen.getByTestId("card").textContent).toMatch(/1[.,]?000/);
  });

  it("documents card is always present, even with no documents", async () => {
    wrap(await DocumentsCard());
    expect(screen.getByTestId("card")).toHaveAttribute("href", "/reports/documents");
  });
});

describe("ReportsStatus", () => {
  function allOk() {
    data.incomeReport.mockResolvedValue(ok());
    data.tradesReport.mockResolvedValue(ok());
    data.contributionsReport.mockResolvedValue(ok());
    data.taxReport.mockResolvedValue({ status: "ok", holders: [] });
    data.goldReport.mockResolvedValue(ok());
  }

  it("renders nothing when everything loaded and no FX is missing", async () => {
    allOk();
    const { container } = wrap(await ReportsStatus());
    expect(container).toBeEmptyDOMElement();
  });

  it("merges fxMissingCurrencies across the card payloads into one banner", async () => {
    allOk();
    data.incomeReport.mockResolvedValue(ok({ fxMissingCurrencies: ["USD"] }));
    data.goldReport.mockResolvedValue(ok({ fxMissingCurrencies: ["CHF", "USD"] }));
    wrap(await ReportsStatus());
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("CHF, USD");
  });

  it("surfaces the first failed loader as a DataState instead of silent partial data", async () => {
    allOk();
    data.tradesReport.mockResolvedValue({ status: "rate_limited", retryAfter: 30 });
    wrap(await ReportsStatus());
    expect(screen.getByText(messages.DataState.rateLimitedTitle)).toBeInTheDocument();
  });
});
