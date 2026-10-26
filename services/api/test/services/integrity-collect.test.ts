import { describe, it, expect } from "vitest";
import { collectBodies } from "../../src/services/integrity/index.js";

// A renamed or dropped field must fail loudly, naming the endpoint and the field, rather than
// default into a value a rule would read as "fine" (or die as an anonymous TypeError).

const valuation = (over: Record<string, unknown> = {}) => ({
  displayCurrency: "EUR",
  netWorth: "100",
  totalCost: "100",
  totalMarketValue: "100",
  totalUnrealizedPnL: "0",
  totalRealizedPnL: "0",
  totalIncome: "0",
  totalLiabilities: "0",
  cashTracked: false,
  cashDisplay: {},
  holdings: [],
  fxMissingCurrencies: [],
  asOf: "2026-06-30T12:00:00.000Z",
  ...over,
});

function getter(over: { networth?: Record<string, unknown>; portfolios?: unknown } = {}) {
  return async (url: string): Promise<unknown> => {
    if (url === "/portfolios") return over.portfolios ?? [{ id: "p1" }];
    if (url === "/networth") return valuation(over.networth);
    if (url === "/portfolios/p1/summary") return valuation();
    throw new Error(`unexpected ${url}`);
  };
}

describe("collectBodies", () => {
  it("collects consistent responses", async () => {
    const b = await collectBodies(getter());
    expect(b.portfolios).toHaveLength(1);
    expect(b.networth.netWorth).toBe("100");
  });

  it("names a missing string field and its endpoint", async () => {
    await expect(collectBodies(getter({ networth: { netWorth: undefined } }))).rejects.toThrow(
      /\/networth: expected a string "netWorth"/,
    );
  });

  it("rejects a dropped cashTracked instead of reading it as false", async () => {
    await expect(collectBodies(getter({ networth: { cashTracked: undefined } }))).rejects.toThrow(
      /expected a boolean "cashTracked"/,
    );
  });

  it("rejects a gain block with a missing field", async () => {
    const gain = { value: "1", costOfOpen: "1", netContributed: "1", unrealized: "0", income: "0" };
    await expect(collectBodies(getter({ networth: { gain } }))).rejects.toThrow(
      /expected a string "gain.realized"/,
    );
  });

  it("rejects a missing asOf", async () => {
    await expect(collectBodies(getter({ networth: { asOf: undefined } }))).rejects.toThrow(
      /expected a string "asOf"/,
    );
  });

  it("rejects a non-array portfolio list", async () => {
    await expect(collectBodies(getter({ portfolios: { error: "x" } }))).rejects.toThrow(
      /\/portfolios: expected an array/,
    );
  });
});
