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
// Pass-through spy: lets the win-rate case pin WHICH formatter renders it (for a 0..1
// share, `formatPercent(…).replace("+", "")` would print the same string).
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/utils")>();
  return { ...actual, formatPercentUnsigned: vi.fn(actual.formatPercentUnsigned) };
});

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
import { formatPercentUnsigned } from "@/lib/utils";

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
    // The By-year column holds the same kind of income (dividends, coupons, interest), so
    // it carries the same name — but not one basis: the selected year is the Tf-adjusted
    // incomeYtd, earlier years are gross. The table says so in `byYear.note`.
    expect(messages.Tax.byYear.dividends).toMatch(/investment income/i);
    expect(messages.Tax.byYear.note).toMatch(/Teilfreistellung/);
    // Pin the clause that changed (the netting lands in FSA used / the tax, not in the
    // gains column) — the older ID note already had the Teilfreistellung clause.
    expect(idMessages.Tax.byYear.note).toMatch(/dengan rugi digabungkan dalam FSA terpakai/);
    expect(messages.Tax.byYear.note).toMatch(/with losses netted in FSA used/);
    // /trades shows the same all-income series.
    expect(messages.Trades.dividendsByYear).toMatch(/investment income/i);
    expect(idMessages.Trades.dividendsByYear).toMatch(/pendapatan investasi/i);
    // The /trades summary card is a narrower figure (dividends + coupons inside each
    // trade's holding window), so it gets its own name rather than plain "Dividends".
    expect(messages.Trades.totalDividends).toMatch(/while held/i);
    expect(messages.Tax.byYear.note).toMatch(/income and gains after the Teilfreistellung/);
    // Every other label over a dividend+coupon+interest population uses the same name, in
    // both regimes; the per-trade figure (income inside the holding window) has its own.
    for (const [msgs, income, held] of [
      [messages, /investment income/i, /while held/i],
      [idMessages, /pendapatan investasi/i, /selama dimiliki/i],
    ] as const) {
      expect(msgs.Reports.tax.idMetricDividends).toMatch(income);
      expect(msgs.Tax.id.dividendsTable.title).toMatch(income);
      expect(msgs.Tax.dividendsTable.title).toMatch(income);
      expect(msgs.Trades.dividends).toMatch(held);
      expect(msgs.Trades.totalDividends).toMatch(held);
      expect(msgs.Tax.id.hero.dividendTax).toMatch(income);
      expect(msgs.Tax.dividendsTable.empty).toMatch(income);
      expect(msgs.Tax.id.dividendsTable.empty).toMatch(income);
    }
    // Sweep of the remaining labels whose population includes interest.
    expect(messages.Trades.detail.dividendsCollected).toMatch(/^income collected$/i);
    expect(idMessages.Trades.detail.dividendsCollected).toMatch(/^pendapatan diterima$/i);
    for (const [msgs, interest] of [
      [messages, /interest/i],
      [idMessages, /bunga/i],
    ] as const) {
      expect(msgs.Income.subtitle).toMatch(interest);
      expect(msgs.Income.emptyBody).toMatch(interest);
      expect(msgs.Savings.totalReturnHint).toMatch(interest);
    }
    expect(messages.Tax.hero.dividendsYtdDesc).toMatch(/before/i);
    // The ID-regime by-year column is fed the same `dividendsByYear` (dividends, coupons
    // and interest), so it is renamed too — in both locales.
    expect(messages.Tax.id.byYear.dividends).toMatch(/investment income/i);
    expect(idMessages.Tax.id.byYear.dividends).toMatch(/pendapatan investasi/i);
    expect(idMessages.Tax.byYear.dividends).toMatch(/pendapatan investasi/i);
  });

  it("names the gross-contributed basis of totalReturnPct on Savings as well as Reports", () => {
    expect(messages.Savings.totalReturn).toMatch(/gross contributed/i);
    expect(idMessages.Savings.totalReturn).toMatch(/setoran kotor/i);
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

describe("TradesCard win rate", () => {
  it("renders the win rate unsigned (a share, not a change)", async () => {
    data.tradesReport.mockResolvedValue(
      ok({
        trades: [{ status: "closed", totalReturn: "120", avgHoldingDays: 30 }],
        realizedByYear: [],
        winRate: 0.75,
      }),
    );
    const el = (await TradesCard({ locale: "en" }))!;
    expect(el.props.trend.label).toContain('"pct":"75.00%"');
    expect(el.props.trend.label).not.toContain("+");
    expect(formatPercentUnsigned).toHaveBeenCalledWith(0.75, "en");
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
