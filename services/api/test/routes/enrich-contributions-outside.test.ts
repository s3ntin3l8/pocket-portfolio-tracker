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

describe("enrichContributions — outside-boundary requires user-provided monthlyContribution (S8)", () => {
  it("flags requiresBudgetPlan when boundary='outside' and monthlyContribution is undefined", () => {
    const result = enrichContributions(baseStats(), "1000", fakeFlows, null, "standard", {
      boundary: "outside",
    });
    expect(result.requiresBudgetPlan).toBe(true);
  });

  it("returns a seedAnnualReturn for boundary='outside' when monthlyContribution is provided", () => {
    const result = enrichContributions(baseStats(), "1200", fakeFlows, null, "standard", {
      boundary: "outside",
      monthlyContribution: "100",
    });
    expect(result.seedAnnualReturn).toBeTruthy();
    expect(typeof result.seedAnnualReturn).toBe("string");
    expect(result.requiresBudgetPlan).toBe(false);
  });

  it("returns requiresBudgetPlan=true on outside-boundary without explicit monthlyContribution so the UI can prompt the user", () => {
    const result = enrichContributions(baseStats(), "1000", fakeFlows, null, "standard", {
      boundary: "outside",
    });
    expect(result.requiresBudgetPlan).toBe(true);
  });

  it("does NOT throw on inside-boundary (default) — XIRR seed is the legacy contract there", () => {
    expect(() => enrichContributions(baseStats(), "1100", fakeFlows)).not.toThrow();
  });
});
