import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  aggregateBoundary,
  contributionStats,
  gainSummary,
  summarizePortfolio,
  type CoreTransaction,
} from "../src/index.js";

// Audit G2: one GainSummary derived from summarizePortfolio + contributionStats, so every
// gain figure in the UI can name its basis.

const tx = (p: Partial<CoreTransaction>): CoreTransaction => ({
  instrumentId: null,
  type: "deposit",
  quantity: "0",
  price: "0",
  fees: "0",
  currency: "EUR",
  executedAt: new Date("2026-01-10T00:00:00Z"),
  ...p,
});

// Cash-inside portfolio: 1000 deposited, 2 A @ 100 bought (now 150), 1 B @ 50 bought (no
// price -> valued at cost), 1 A sold @ 130 (realized +30), 5 dividend.
const txns: CoreTransaction[] = [
  tx({ type: "deposit", price: "1000" }),
  tx({
    type: "buy",
    instrumentId: "A",
    quantity: "2",
    price: "100",
    executedAt: new Date("2026-01-11"),
  }),
  tx({
    type: "buy",
    instrumentId: "B",
    quantity: "1",
    price: "50",
    executedAt: new Date("2026-01-12"),
  }),
  tx({
    type: "sell",
    instrumentId: "A",
    quantity: "1",
    price: "130",
    executedAt: new Date("2026-01-13"),
  }),
  tx({
    type: "dividend",
    instrumentId: "A",
    price: "5",
    quantity: "1",
    executedAt: new Date("2026-01-14"),
  }),
];

describe("gainSummary", () => {
  const summary = summarizePortfolio({
    transactions: txns,
    prices: { A: { price: "150", currency: "EUR" } },
    displayCurrency: "EUR",
    cashCounted: true,
  });
  const stats = contributionStats({ txns, displayCurrency: "EUR", boundary: "inside" });
  const g = gainSummary({ summary, contribution: stats, boundary: "inside" });

  it("pairs each figure with its own basis", () => {
    expect(g.displayCurrency).toBe("EUR");
    expect(g.boundary).toBe("inside");
    // value is net worth incl. cash: 1000 - 200 - 50 + 130 + 5 cash = 885, + A 150 + B 50 at cost
    expect(g.value).toBe(summary.netWorth);
    expect(g.value).toBe("1085");
    // open holdings cost: A 1 @ 100 + B 1 @ 50
    expect(g.costOfOpen).toBe("150");
    // inside boundary: net contributed is deposits - withdrawals, never buys
    expect(g.netContributed).toBe("1000");
    // A: 150 - 100; B valued at cost contributes exactly 0
    expect(g.unrealized).toBe("50");
    expect(g.realized).toBe("30");
    expect(g.income).toBe("5");
  });

  it("is consistent: unrealized = marketValue - costOfOpen, so the at-cost row adds nothing", () => {
    const atCost = summary.holdings.find((h) => h.instrumentId === "B");
    expect(atCost?.valuedAtCost).toBe(true);
    expect(atCost?.unrealizedPnLDisplay).toBe("0");
    expect(new Decimal(summary.totalMarketValue).sub(g.costOfOpen).toString()).toBe(g.unrealized);
  });
});

describe("aggregateBoundary", () => {
  it("returns the shared boundary, or mixed when portfolios disagree", () => {
    expect(aggregateBoundary(["inside", "inside"])).toBe("inside");
    expect(aggregateBoundary(["outside"])).toBe("outside");
    expect(aggregateBoundary(["inside", "outside"])).toBe("mixed");
  });
});
