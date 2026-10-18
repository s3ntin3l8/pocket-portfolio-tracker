import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import idMessages from "../messages/id.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => {
    const bag = (messages as unknown as Record<string, unknown>)[ns] ?? {};
    return (key: string, vals?: Record<string, unknown>) => {
      // Resolve dotted keys ("income.caption") through the nested namespace.
      const found = key
        .split(".")
        .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], bag);
      const v = typeof found === "string" ? found : key;
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

  it("income card names what it counts and that its trend compares a full-year estimate", async () => {
    data.incomeReport.mockResolvedValue(
      ok({
        thisYear: "50",
        lastYear: "100",
        forecastFullYear: "200",
        ttm: "1",
        lifetimeTotal: "1",
      }),
    );
    const el = (await IncomeCard({ locale: "en" }))!;
    // Interest is not in this figure (the /income page shows it as its own line).
    expect(el.props.caption).toMatch(/dividends & coupons/i);
    // +100% = 200 (estimated full year) vs 100 last year — not the 50 received so far (−50%).
    expect(el.props.trend.label).toMatch(/est/i);
    expect(el.props.trend.label).toContain("+100");
  });

  it("savings card labels total return with its basis and never swaps in another basis", async () => {
    const base = {
      netContributed: "100",
      currentValue: "127.89",
      monthlyAverage: "10",
      simpleGainPct: 0.2789,
      xirr: 0.07,
    };
    data.contributionsReport.mockResolvedValue(ok({ ...base, totalReturnPct: 0.2816 }));
    const withTotal = (await SavingsCard({ locale: "en" }))!;
    const ret = withTotal.props.metrics.find((m: { value: string }) => m.value.includes("28.16"));
    expect(ret.label).not.toBe("Total return");
    // Its denominator is gross contributed, unlike the headline's net — the label names it.
    expect(ret.label).toMatch(/gross contributed/i);

    // No total return (cash-inside scope, whose headline gain already is total return):
    // the metric is omitted, not filled with simpleGainPct under the "Total return" label.
    data.contributionsReport.mockResolvedValue(ok({ ...base, totalReturnPct: null }));
    const without = (await SavingsCard({ locale: "en" }))!;
    expect(without.props.metrics.some((m: { value: string }) => m.value.includes("27.89"))).toBe(
      false,
    );
    expect(without.props.metrics).toHaveLength(1);

    // An absent field (an API predating it) is treated like null, never formatted as "NaN%".
    data.contributionsReport.mockResolvedValue(ok({ ...base }));
    const absent = (await SavingsCard({ locale: "en" }))!;
    expect(absent.props.metrics).toHaveLength(1);
  });

  it("DE tax card calls its income figure investment income, not dividends", async () => {
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
    const el = (await TaxCard({ locale: "en" }))!;
    const labels = el.props.metrics.map((m: { label: string }) => m.label);
    expect(labels).toContain("Investment income YTD");
    expect(labels.join(" ")).not.toMatch(/dividends/i);
  });

  it("tax hero labels its income figure as all capital income before the allowance", () => {
    for (const msgs of [messages, idMessages]) {
      const hero = (msgs as unknown as { Tax: { hero: Record<string, string> } }).Tax.hero;
      expect(hero.dividendsYtdDesc).not.toContain("{allowance}");
    }
    expect(messages.Tax.hero.dividendsYtd).toMatch(/investment income/i);
    // The By-year column holds the same figure (current year: incomeYtd; past years: all
    // capital income incl. interest), so it carries the same name.
    expect(messages.Tax.byYear.dividends).toMatch(/investment income/i);
    expect(messages.Tax.hero.dividendsYtdDesc).toMatch(/before/i);
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

  it("includes the tax payload's missing currencies (EUR allowance without a rate)", async () => {
    allOk();
    data.taxReport.mockResolvedValue({
      status: "ok",
      holders: [{ fxMissingCurrencies: ["EUR"] }],
    });
    wrap(await ReportsStatus());
    expect(screen.getByRole("status")).toHaveTextContent("EUR");
  });

  it("surfaces the first failed loader as a DataState instead of silent partial data", async () => {
    allOk();
    data.tradesReport.mockResolvedValue({ status: "rate_limited", retryAfter: 30 });
    wrap(await ReportsStatus());
    expect(screen.getByText(messages.DataState.rateLimitedTitle)).toBeInTheDocument();
  });
});
