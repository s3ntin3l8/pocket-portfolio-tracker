import { describe, it, expect } from "vitest";
import { expectSameAggregate, expectScaled, scale, type Outputs } from "./metamorphic.js";
import { eurBasic } from "./ledgers/eur-basic.js";
import { cashInside } from "./ledgers/cash-inside.js";

// The relation helpers must be able to fail, or every relation passes vacuously.

function body(k: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  const m = (v: number) => String(v * k);
  return {
    netWorth: m(1260),
    totalCost: m(960),
    totalMarketValue: m(1260),
    totalUnrealizedPnL: m(300),
    totalRealizedPnL: m(140),
    totalIncome: m(30),
    totalLiabilities: "0",
    gain: {
      boundary: "outside",
      value: m(1260),
      costOfOpen: m(960),
      netContributed: m(960),
      unrealized: m(300),
      realized: m(140),
      income: m(30),
    },
    fxMissingCurrencies: [],
    xirr: 0.1,
    ...over,
  };
}

const out = (k = 1, over: Record<string, unknown> = {}): Outputs => ({
  networth: body(k, over),
  perPortfolio: { a: body(k, over) },
});

describe("relation helpers", () => {
  it("accept identical and correctly scaled outputs", () => {
    expect(() => expectScaled(out(), out(), 1)).not.toThrow();
    expect(() => expectScaled(out(), out(3), 3)).not.toThrow();
    expect(() => expectSameAggregate(out(), out())).not.toThrow();
  });

  it("reject a money figure that is off, at the aggregate or in one portfolio", () => {
    expect(() => expectScaled(out(), out(1, { totalIncome: "31" }), 1)).toThrow(/totalIncome/);
    const b = out();
    (b.perPortfolio.a!.gain as Record<string, string>).realized = "141";
    expect(() => expectScaled(out(), b, 1)).toThrow(/portfolio\[a\]\.gain\.realized/);
  });

  it("reject a scale factor that was not applied, and a different boundary", () => {
    expect(() => expectScaled(out(), out(1), 3)).toThrow();
    const b = out();
    (b.networth.gain as Record<string, string>).boundary = "inside";
    expect(() => expectScaled(out(), b, 1)).toThrow(/boundary/);
  });

  it("reject a changed XIRR unless told to skip it", () => {
    expect(() => expectScaled(out(), out(1, { xirr: 0.2 }), 1)).toThrow(/xirr/);
    expect(() =>
      expectSameAggregate(out(), out(1, { xirr: 0.2 }), { skipXirr: true }),
    ).not.toThrow();
  });
});

describe("transforms", () => {
  it("scale multiplies quantities and lump sums but not per-unit prices", () => {
    const s = scale(eurBasic, 3);
    const buy = s.transactions.find((t) => t.type === "buy")!;
    expect([buy.quantity, buy.price]).toEqual(["30", "100"]);
    const dividend = s.transactions.find((t) => t.type === "dividend")!;
    expect([dividend.quantity, dividend.price]).toEqual([undefined, "90"]);
    const deposit = scale(cashInside, 2).transactions.find((t) => t.type === "deposit")!;
    expect(deposit.price).toBe("2000");
  });

  it("derived scenarios get their own name and reuse (not re-insert) fx", () => {
    const s = scale(eurBasic, 3);
    expect(s.name).not.toBe(eurBasic.name);
    expect(s.fx).toEqual([]);
  });
});
