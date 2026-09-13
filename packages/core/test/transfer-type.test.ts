/**
 * Tests for first-class transfer_in / transfer_out transaction type (PR #309).
 * Covers: holdings, cashFlow, contributions (inside + outside boundary), trade-log.
 */
import { describe, it, expect } from "vitest";
import {
  computeHoldings,
  cashFlow,
  contributionStats,
  boundaryFlowPoints,
  transferFlowPoints,
} from "../src/index.js";
import type { CoreTransaction } from "../src/index.js";

function tx(p: Partial<CoreTransaction>): CoreTransaction {
  return {
    instrumentId: "INST-A",
    type: "buy",
    quantity: "0",
    price: "0",
    fees: "0",
    currency: "EUR",
    executedAt: new Date("2022-09-16"),
    ...p,
  };
}

// ---------------------------------------------------------------------------
// cashFlow — transfers are cash-neutral (only fees reduce cash)
// ---------------------------------------------------------------------------
describe("cashFlow — transfer_in / transfer_out", () => {
  it("transfer_in with no fees → 0 cash effect", () => {
    const t = tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0" });
    // f.neg() returns -0 when fees=0; use abs() to treat both as zero.
    expect(Math.abs(cashFlow(t).toNumber())).toBe(0);
  });

  it("transfer_out with no fees → 0 cash effect", () => {
    const t = tx({ type: "transfer_out", quantity: "5", price: "100", fees: "0" });
    expect(Math.abs(cashFlow(t).toNumber())).toBe(0);
  });

  it("transfer_in with fees → negative cash (fee paid)", () => {
    const t = tx({ type: "transfer_in", quantity: "10", price: "100", fees: "2" });
    expect(cashFlow(t).toNumber()).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// computeHoldings — transfer_in adds shares at carried basis; transfer_out removes
// ---------------------------------------------------------------------------
describe("computeHoldings — transfer_in", () => {
  it("adds quantity at carried cost basis", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "125.40", fees: "0" })];
    const [h] = computeHoldings(txns);
    expect(h.quantity).toBe("10");
    expect(h.avgCost).toBe("125.4");
    expect(h.costBasis).toBe("1254");
    expect(h.realizedPnL).toBe("0");
  });

  it("subsequent sell uses carried basis for realized P&L", () => {
    const txns = [
      tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "sell",
        quantity: "5",
        price: "150",
        fees: "1",
        executedAt: new Date("2023-06-01"),
      }),
    ];
    const [h] = computeHoldings(txns);
    expect(h.quantity).toBe("5");
    // Realized = 5×150 − 1 (fee) − 5×100 (cost) = 750 − 1 − 500 = 249
    expect(h.realizedPnL).toBe("249");
  });

  it("transfer_in with fees includes fees in cost basis", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "100", fees: "10" })];
    const [h] = computeHoldings(txns);
    expect(h.costBasis).toBe("1010"); // 10×100 + 10
    expect(h.avgCost).toBe("101");
  });
});

describe("computeHoldings — transfer_out", () => {
  it("removes shares at average cost without realizing P&L", () => {
    const txns = [
      tx({ type: "buy", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "transfer_out",
        quantity: "4",
        price: "0",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const [h] = computeHoldings(txns);
    expect(h.quantity).toBe("6");
    expect(h.costBasis).toBe("600"); // 6 × 100
    expect(h.realizedPnL).toBe("0"); // NOT a disposal
  });

  it("clamps transfer_out to available quantity (no negative holding)", () => {
    const txns = [
      tx({ type: "buy", quantity: "5", price: "100", fees: "0" }),
      tx({
        type: "transfer_out",
        quantity: "10",
        price: "0",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const [h] = computeHoldings(txns);
    expect(h.quantity).toBe("0");
    expect(h.realizedPnL).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// contributionStats — INSIDE boundary: transfers count as contributed capital
// ---------------------------------------------------------------------------
describe("contributionStats — transfer_in inside boundary", () => {
  it("counts transfer_in inflow at carried cost × qty", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "125", fees: "0" })];
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "inside" });
    // 10 × 125 = 1250
    expect(s.totalContributed).toBe("1250");
    expect(s.netContributed).toBe("1250");
  });

  it("transfer_in at zero basis contributes 0 (phantom gain scenario)", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "0", fees: "0" })];
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "inside" });
    expect(s.totalContributed).toBe("0");
  });

  it("transfer_out reduces contributed capital", () => {
    const txns = [
      tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "transfer_out",
        quantity: "4",
        price: "100",
        fees: "0",
        executedAt: new Date("2023-03-01"),
      }),
    ];
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "inside" });
    // In: 1000, Out: 400, Net: 600
    expect(s.totalContributed).toBe("1000");
    expect(s.totalWithdrawn).toBe("400");
    expect(s.netContributed).toBe("600");
  });
});

// ---------------------------------------------------------------------------
// contributionStats — OUTSIDE boundary: transfer_in is inflow at cost
// ---------------------------------------------------------------------------
describe("contributionStats — transfer_in outside boundary", () => {
  it("counts transfer_in as contributed capital (is externally owned capital)", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0" })];
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "outside" });
    expect(s.totalContributed).toBe("1000");
    expect(s.netContributed).toBe("1000");
  });

  it("transfer_out reduces pool and counts as outflow at average cost", () => {
    const txns = [
      tx({ type: "buy", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "transfer_out",
        quantity: "4",
        price: "0",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "outside" });
    // Inflow: 1000 (buy), Outflow: 400 (4 × avg 100), Net: 600
    expect(s.totalContributed).toBe("1000");
    expect(s.totalWithdrawn).toBe("400");
    expect(s.netContributed).toBe("600");
  });

  it("buy + transfer_in + sell flows correctly", () => {
    const txns = [
      tx({ type: "buy", quantity: "5", price: "100", fees: "0" }),
      tx({
        type: "transfer_in",
        quantity: "5",
        price: "80",
        fees: "0",
        executedAt: new Date("2022-10-01"),
      }),
      // Sell 3 shares. Pool = 10 shares, cost = 500+400=900, avg = 90.
      // Outflow = 3 × 90 = 270.
      tx({
        type: "sell",
        quantity: "3",
        price: "150",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "outside" });
    expect(s.totalContributed).toBe("900"); // 500 buy + 400 transfer
    expect(s.totalWithdrawn).toBe("270"); // 3 × avg 90
    expect(s.netContributed).toBe("630");
  });
});

// ---------------------------------------------------------------------------
// tr-csv.ts FREE_RECEIPT routing — import tested via the parseTrCsv function
// ---------------------------------------------------------------------------
describe("transfer_in: zero price is not priceRequired in holdings", () => {
  it("transfer_in rows with price 0 are kept (basis supplied by user later)", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "0", fees: "0" })];
    const holdings = computeHoldings(txns);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].quantity).toBe("10");
    expect(holdings[0].costBasis).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// boundaryFlowPoints (#736) — the per-transaction, XIRR-convention view of the SAME
// boundary walk contributionStats uses. Every case here has a `contributionStats`
// counterpart above; the numbers must agree (same walk, different shape).
// ---------------------------------------------------------------------------
const fx = () => "1";

describe("boundaryFlowPoints — inside boundary", () => {
  it("transfer_in is an inflow (negative) at carried cost × qty", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "125", fees: "0" })];
    const points = boundaryFlowPoints(txns, "inside", "EUR", fx);
    expect(points).toEqual([{ amount: -1250, date: txns[0].executedAt }]);
  });

  it("transfer_out is an outflow (positive) at carried cost × qty", () => {
    const txns = [
      tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "transfer_out",
        quantity: "4",
        price: "100",
        fees: "0",
        executedAt: new Date("2023-03-01"),
      }),
    ];
    const points = boundaryFlowPoints(txns, "inside", "EUR", fx);
    expect(points).toEqual([
      { amount: -1000, date: txns[0].executedAt },
      { amount: 400, date: txns[1].executedAt },
    ]);
    // Matches contributionStats's totalContributed/totalWithdrawn for the same txns.
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "inside" });
    expect(-points.filter((p) => p.amount < 0).reduce((a, p) => a + p.amount, 0)).toBe(
      Number(s.totalContributed),
    );
    expect(points.filter((p) => p.amount > 0).reduce((a, p) => a + p.amount, 0)).toBe(
      Number(s.totalWithdrawn),
    );
  });

  it("plain deposit/withdrawal keep the existing sign convention (deposit negative, withdrawal positive)", () => {
    const txns = [
      tx({
        type: "deposit",
        instrumentId: null,
        quantity: "0",
        price: "500",
        fees: "0",
        executedAt: new Date("2022-01-01"),
      }),
      tx({
        type: "withdrawal",
        instrumentId: null,
        quantity: "0",
        price: "200",
        fees: "0",
        executedAt: new Date("2022-02-01"),
      }),
    ];
    const points = boundaryFlowPoints(txns, "inside", "EUR", fx);
    expect(points).toEqual([
      { amount: -500, date: txns[0].executedAt },
      { amount: 200, date: txns[1].executedAt },
    ]);
  });
});

describe("boundaryFlowPoints — outside boundary", () => {
  it("transfer_in is an inflow (negative) at gross cost, matching contributionStats", () => {
    const txns = [tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0" })];
    const points = boundaryFlowPoints(txns, "outside", "EUR", fx);
    expect(points).toEqual([{ amount: -1000, date: txns[0].executedAt }]);
  });

  it("transfer_out is an outflow (positive) at running average cost", () => {
    const txns = [
      tx({ type: "buy", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "transfer_out",
        quantity: "4",
        price: "0",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const points = boundaryFlowPoints(txns, "outside", "EUR", fx);
    expect(points).toEqual([
      { amount: -1000, date: txns[0].executedAt },
      { amount: 400, date: txns[1].executedAt },
    ]);
  });

  it("buy + transfer_in + sell: points sum to the same totals as contributionStats", () => {
    const txns = [
      tx({ type: "buy", quantity: "5", price: "100", fees: "0" }),
      tx({
        type: "transfer_in",
        quantity: "5",
        price: "80",
        fees: "0",
        executedAt: new Date("2022-10-01"),
      }),
      tx({
        type: "sell",
        quantity: "3",
        price: "150",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const points = boundaryFlowPoints(txns, "outside", "EUR", fx);
    const totalContributed = -points.filter((p) => p.amount < 0).reduce((a, p) => a + p.amount, 0);
    const totalWithdrawn = points.filter((p) => p.amount > 0).reduce((a, p) => a + p.amount, 0);
    const s = contributionStats({ txns, displayCurrency: "EUR", boundary: "outside" });
    expect(totalContributed).toBe(Number(s.totalContributed));
    expect(totalWithdrawn).toBe(Number(s.totalWithdrawn));
    // 500 buy + 400 transfer_in inflow; 270 (3 × avg 90) sell outflow.
    expect(totalContributed).toBe(900);
    expect(totalWithdrawn).toBe(270);
  });

  it("a non-externally-funded acquisition (saveback) produces no point but still draws the pool", () => {
    const txns = [
      tx({ type: "buy", quantity: "10", price: "100", fees: "0", kind: "saveback" }),
      tx({
        type: "sell",
        quantity: "5",
        price: "150",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    const points = boundaryFlowPoints(txns, "outside", "EUR", fx);
    // No inflow point for the saveback buy; the sell still draws the pool it built.
    expect(points).toEqual([{ amount: 500, date: txns[1].executedAt }]);
  });

  it("archived/draft rows never produce a flow point", () => {
    const txns = [
      tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0", status: "archived" }),
      tx({
        type: "transfer_in",
        quantity: "5",
        price: "100",
        fees: "0",
        status: "draft",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    expect(boundaryFlowPoints(txns, "inside", "EUR", fx)).toEqual([]);
    expect(boundaryFlowPoints(txns, "outside", "EUR", fx)).toEqual([]);
  });
});

describe("transferFlowPoints — isolating just the transfer rows (issue #736)", () => {
  it("outside boundary: drops buy/sell, keeps only transfer_in/transfer_out at cost", () => {
    const txns = [
      tx({ type: "buy", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "transfer_in",
        quantity: "5",
        price: "100",
        fees: "0",
        executedAt: new Date("2022-10-01"),
      }),
      tx({
        type: "sell",
        quantity: "5",
        price: "150",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
      tx({
        type: "transfer_out",
        quantity: "5",
        price: "0",
        fees: "0",
        executedAt: new Date("2023-02-01"),
      }),
    ];
    const points = transferFlowPoints(txns, "outside", "EUR", fx);
    // Only the two transfer rows survive — buy and sell are excluded even though
    // they produce points (500 inflow, 500 outflow at the same avg cost) in the
    // full boundaryFlowPoints walk.
    expect(points).toEqual([
      { amount: -500, date: txns[1].executedAt },
      { amount: 500, date: txns[3].executedAt },
    ]);
  });

  it("the legacy bonus+kind:transfer_in pattern counts as a transfer", () => {
    const txns = [
      tx({ type: "buy", quantity: "10", price: "100", fees: "0" }),
      tx({
        type: "bonus",
        kind: "transfer_in",
        quantity: "5",
        price: "80",
        fees: "0",
        executedAt: new Date("2022-10-01"),
      }),
    ];
    expect(transferFlowPoints(txns, "outside", "EUR", fx)).toEqual([
      { amount: -400, date: txns[1].executedAt },
    ]);
  });

  it("inside boundary: transfer_in/transfer_out survive, deposit/withdrawal are dropped", () => {
    const txns = [
      tx({ type: "deposit", price: "1000", fees: "0" }),
      tx({
        type: "transfer_in",
        quantity: "5",
        price: "100",
        fees: "0",
        executedAt: new Date("2022-10-01"),
      }),
      tx({
        type: "withdrawal",
        price: "200",
        fees: "0",
        executedAt: new Date("2023-01-01"),
      }),
    ];
    expect(transferFlowPoints(txns, "inside", "EUR", fx)).toEqual([
      { amount: -500, date: txns[1].executedAt },
    ]);
  });

  it("archived/draft transfer rows are excluded", () => {
    const txns = [
      tx({ type: "transfer_in", quantity: "10", price: "100", fees: "0", status: "archived" }),
    ];
    expect(transferFlowPoints(txns, "outside", "EUR", fx)).toEqual([]);
    expect(transferFlowPoints(txns, "inside", "EUR", fx)).toEqual([]);
  });
});
