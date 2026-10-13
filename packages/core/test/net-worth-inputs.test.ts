import { describe, it, expect } from "vitest";
import { netWorthInputs, summarizePortfolio, type CoreTransaction } from "../src/index.js";

// Audit B6: the cash/liabilities half of net worth, shared by summarizePortfolio and the
// backfill snapshot writer.

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
const fx = (from: string, to: string) => (from === to ? "1" : from === "USD" ? "0.9" : null);

describe("netWorthInputs", () => {
  it("untracked cash (buys without a funding deposit) counts as no cash, not negative cash", () => {
    const txns = [tx({ type: "buy", instrumentId: "i1", quantity: "2", price: "100" })];
    const r = netWorthInputs({ transactions: txns, cashCounted: true, displayCurrency: "EUR", fx });
    expect(r.cashTracked).toBe(false);
    expect(r.cash).toEqual({});
    expect(r.convertibleCash).toEqual({});
    expect(r.liabilities).toBe("0");
  });

  it("tracked cash inside the boundary is counted; outside the boundary it never is", () => {
    const txns = [
      tx({ type: "deposit", price: "500" }),
      tx({ type: "buy", instrumentId: "i1", quantity: "2", price: "100" }),
    ];
    const inside = netWorthInputs({
      transactions: txns,
      cashCounted: true,
      displayCurrency: "EUR",
      fx,
    });
    expect(inside.cashTracked).toBe(true);
    expect(inside.convertibleCash).toEqual({ EUR: "300" });
    const outside = netWorthInputs({
      transactions: txns,
      cashCounted: false,
      displayCurrency: "EUR",
      fx,
    });
    expect(outside.cash).toEqual({});
  });

  it("a loan's outstanding principal is a liability, converted to the display currency", () => {
    const txns = [
      tx({ type: "loan_drawdown", price: "1000", loanId: "l1", currency: "USD" }),
      tx({ type: "loan_repayment", price: "200", loanId: "l1", currency: "USD" }),
    ];
    const r = netWorthInputs({ transactions: txns, cashCounted: true, displayCurrency: "EUR", fx });
    expect(r.liabilities).toBe("720");
    // A loan leg is an explicit cash movement — cash tracking switches on.
    expect(r.cashTracked).toBe(true);
  });

  it("leaves an unconvertible currency in `cash` but out of `convertibleCash` and liabilities", () => {
    const txns = [
      tx({ type: "deposit", price: "100", currency: "XYZ" }),
      tx({ type: "loan_drawdown", price: "50", loanId: "l2", currency: "XYZ" }),
    ];
    const r = netWorthInputs({ transactions: txns, cashCounted: true, displayCurrency: "EUR", fx });
    expect(r.cash).toEqual({ XYZ: "150" });
    expect(r.convertibleCash).toEqual({});
    expect(r.liabilities).toBe("0");
  });

  it("is what summarizePortfolio uses (cash + liabilities agree)", () => {
    const txns = [
      tx({ type: "deposit", price: "500" }),
      tx({ type: "loan_drawdown", price: "300", loanId: "l1" }),
      tx({ type: "buy", instrumentId: "i1", quantity: "2", price: "100" }),
    ];
    const s = summarizePortfolio({
      transactions: txns,
      prices: { i1: { price: "110", currency: "EUR" } },
      displayCurrency: "EUR",
      fx,
      cashCounted: true,
    });
    const r = netWorthInputs({ transactions: txns, cashCounted: true, displayCurrency: "EUR", fx });
    expect(s.cash).toEqual(r.cash);
    expect(s.totalLiabilities).toBe(r.liabilities);
    // 220 securities + 600 cash − 300 loan
    expect(s.netWorth).toBe("520");
  });
});
