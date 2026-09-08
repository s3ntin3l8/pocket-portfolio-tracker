import { describe, it, expect } from "vitest";
import type { CashFlowPoint, ContributionStats } from "@portfolio/core";
import { enrichContributions } from "../../src/routes/transactions/shared/contributions.js";

const fakeFlows: CashFlowPoint[] = [{ amount: 0, date: new Date("2026-01-31") }];

function baseStats(): ContributionStats {
  return {
    displayCurrency: "EUR",
    totalContributed: "1000",
    totalWithdrawn: "0",
    netContributed: "1000",
    monthsElapsed: 1,
    monthsActive: 1,
    monthlyAverage: "1000",
    series: [{ month: "2026-01", contributed: "1000" }],
    dailySeries: [{ date: "2026-01-31", contributed: "1000" }],
  };
}

describe("enrichContributions — basic contract", () => {
  it("does not include requiresBudgetPlan", () => {
    const result = enrichContributions(baseStats(), "1000", fakeFlows, null, "standard");
    expect(result).not.toHaveProperty("requiresBudgetPlan");
  });

  it("returns a seedAnnualReturn when currentValue is provided", () => {
    const result = enrichContributions(baseStats(), "1200", fakeFlows, null, "standard");
    expect(result.seedAnnualReturn).toBeTruthy();
    expect(typeof result.seedAnnualReturn).toBe("string");
    expect(result).not.toHaveProperty("requiresBudgetPlan");
  });

  it("does NOT throw on default call — XIRR seed is the legacy contract", () => {
    expect(() => enrichContributions(baseStats(), "1100", fakeFlows)).not.toThrow();
  });
});
