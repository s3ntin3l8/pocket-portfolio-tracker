import { describe, it, expect } from "vitest";
import {
  enrichContributions,
  type CashFlowPoint,
} from "../../src/routes/transactions/shared/contributions.js";

const fakeFlows: CashFlowPoint[] = [{ amount: 0, date: new Date("2026-01-31") }];

describe("enrichContributions — outside-boundary requires user-provided monthlyContribution (S8)", () => {
  it("flags requiresBudgetPlan when boundary='outside' and monthlyContribution is undefined", () => {
    const result = enrichContributions(
      {
        totalContributed: "1000",
        netContributed: "1000",
        monthsActive: 1,
        series: [{ month: "2026-01", contributed: "1000" }],
        bonusesByYear: {},
      },
      "1000",
      fakeFlows,
      null,
      "standard",
      { boundary: "outside" },
    );
    expect(result.requiresBudgetPlan).toBe(true);
  });

  it("returns a seedAnnualReturn for boundary='outside' when monthlyContribution is provided", () => {
    const result = enrichContributions(
      {
        totalContributed: "1000",
        netContributed: "1000",
        monthsActive: 1,
        series: [{ month: "2026-01", contributed: "1000" }],
        bonusesByYear: {},
      },
      "1200",
      fakeFlows,
      null,
      "standard",
      { boundary: "outside", monthlyContribution: "100" },
    );
    expect(result.seedAnnualReturn).toBeTruthy();
    expect(typeof result.seedAnnualReturn).toBe("string");
    expect(result.requiresBudgetPlan).toBe(false);
  });

  it("returns requiresBudgetPlan=true on outside-boundary without explicit monthlyContribution so the UI can prompt the user", () => {
    const result = enrichContributions(
      {
        totalContributed: "1000",
        netContributed: "1000",
        monthsActive: 1,
        series: [{ month: "2026-01", contributed: "1000" }],
        bonusesByYear: {},
      },
      "1000",
      fakeFlows,
      null,
      "standard",
      { boundary: "outside" },
    );
    expect(result.requiresBudgetPlan).toBe(true);
  });

  it("does NOT throw on inside-boundary (default) — XIRR seed is the legacy contract there", () => {
    expect(() =>
      enrichContributions(
        {
          totalContributed: "1000",
          netContributed: "1000",
          monthsActive: 1,
          series: [{ month: "2026-01", contributed: "1000" }],
          bonusesByYear: {},
        },
        "1100",
        fakeFlows,
      ),
    ).not.toThrow();
  });
});
