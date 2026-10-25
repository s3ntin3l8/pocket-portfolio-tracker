import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { TradeLog } from "@portfolio/api-client";

/**
 * Audit E1/E2/E3 — the trades page's two bar charts.
 *
 * The bars are drawn against a ZERO baseline: a loss year grows DOWNWARD (it used to be
 * drawn as an upward bar of the same height as an equal gain), the scale uses the real
 * largest magnitude (no floor), and a year without an amount renders NO bar.
 */

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (ns: string) => {
    const bag = (messages as unknown as Record<string, Record<string, string>>)[ns] ?? {};
    return (key: string) => bag[key] ?? key;
  },
}));

const tradeLog = {
  status: "ok",
  data: {
    displayCurrency: "EUR",
    method: "average",
    trades: [{ id: "t1", symbol: "ACME", status: "closed", invested: "100", totalReturn: "20" }],
    totalRealized: "1000",
    totalDividends: "100",
    totalReturn: "1200",
    winRate: 0.5,
    realizedByYear: [],
    dividendsByYear: [],
    bonusesByYear: [],
  } as unknown as TradeLog,
};

vi.mock("@/lib/server-api", () => ({
  loadPreferences: async () => ({ costBasisMode: "purchase_price" }),
  loadTrades: async () => tradeLog,
}));

// Client components are out of scope here — stub them with identifiable markers.
vi.mock("@/components/trades-table", () => ({ TradesTable: () => <div data-testid="trades" /> }));
vi.mock("@/components/trade-method-toggle", () => ({ TradeMethodToggle: () => null }));
vi.mock("@/components/trades-page-commands", () => ({ TradesPageCommands: () => null }));

import TradesPage from "../src/app/[locale]/(app)/trades/page";

async function renderPage() {
  const ui = await TradesPage({
    params: Promise.resolve({ locale: "en" }),
    searchParams: Promise.resolve({}),
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function bar(year: number, testId: string) {
  return document.querySelector<HTMLElement>(`[data-testid="${testId}"][data-year="${year}"]`);
}

beforeEach(() => {
  tradeLog.data.realizedByYear = [];
  tradeLog.data.dividendsByYear = [];
});

describe("trades page — realized-by-year bars (audit E1/E3)", () => {
  it("draws a loss year DOWNWARD from the zero baseline, not as an upward bar", async () => {
    tradeLog.data.realizedByYear = [
      { year: 2023, amount: "1000" },
      { year: 2024, amount: "-400" },
    ];
    await renderPage();

    const gain = bar(2023, "realized-bar");
    const loss = bar(2024, "realized-bar");
    expect(gain).not.toBeNull();
    expect(loss).not.toBeNull();

    expect(gain?.dataset.direction).toBe("up");
    expect(loss?.dataset.direction).toBe("down");

    // The baseline sits in the middle when gains and losses share the chart, and the
    // two halves use one scale: −400 is half the size of +1000.
    expect(gain?.style.bottom).toBe("50%");
    expect(loss?.style.top).toBe("50%");
    expect(gain?.style.height).toBe("50%");
    expect(loss?.style.height).toBe("20%");
  });

  it("renders NO bar for a year without an amount (no floored stub bar)", async () => {
    tradeLog.data.realizedByYear = [
      { year: 2023, amount: "1000" },
      { year: 2024, amount: "0" },
    ];
    await renderPage();

    expect(bar(2023, "realized-bar")).not.toBeNull();
    expect(bar(2024, "realized-bar")).toBeNull();
  });

  it("scales against the real maximum, so the largest bar fills the plot area", async () => {
    tradeLog.data.realizedByYear = [
      { year: 2023, amount: "0.40" },
      { year: 2024, amount: "0.20" },
    ];
    await renderPage();

    expect(bar(2023, "realized-bar")?.style.height).toBe("100%");
    expect(bar(2024, "realized-bar")?.style.height).toBe("50%");
  });
});

describe("trades page — dividends-by-year bars (audit E2/E3)", () => {
  it("renders a negative dividend year as a visible downward bar", async () => {
    tradeLog.data.dividendsByYear = [
      { year: 2023, amount: "100", tax: "0" },
      { year: 2024, amount: "-40", tax: "0" },
    ];
    await renderPage();

    const gain = bar(2023, "dividend-bar");
    const loss = bar(2024, "dividend-bar");
    expect(gain).not.toBeNull();
    expect(loss).not.toBeNull();

    expect(loss?.dataset.direction).toBe("down");
    // A negative percentage must never reach the height style (it would be invalid CSS
    // and the bar would collapse to nothing).
    expect(loss?.style.height).toBe("20%");
    expect(Number.parseFloat(loss?.style.height ?? "0")).toBeGreaterThan(0);
  });

  it("renders no bar for a year without dividends", async () => {
    tradeLog.data.dividendsByYear = [
      { year: 2023, amount: "100", tax: "0" },
      { year: 2024, amount: "0", tax: "0" },
    ];
    await renderPage();

    expect(bar(2023, "dividend-bar")).not.toBeNull();
    expect(bar(2024, "dividend-bar")).toBeNull();
  });
});
