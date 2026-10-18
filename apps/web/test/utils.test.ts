import { describe, it, expect } from "vitest";
import {
  isRowAnomaly,
  rowAnomalyCounts,
  bannerAnomalies,
  formatPercent,
  formatPercentUnsigned,
  formatMoneyWhole,
} from "@/lib/utils";
import type { Anomaly } from "@portfolio/api-client";

// Minimal anomaly builder — only the fields these helpers read.
function a(p: Partial<Anomaly> & Pick<Anomaly, "severity">): Anomaly {
  return { code: "zero_price", scope: "transaction", ...p };
}

describe("isRowAnomaly", () => {
  it("is true when transactionId is present", () => {
    expect(isRowAnomaly({ transactionId: "tx-1" })).toBe(true);
  });

  it("is false when transactionId is absent", () => {
    expect(isRowAnomaly({})).toBe(false);
  });
});

describe("rowAnomalyCounts", () => {
  it("counts only row-attached anomalies, ignoring ones with no transactionId", () => {
    const anomalies: Anomaly[] = [
      a({ severity: "warning", transactionId: "tx-1" }),
      a({ severity: "error", transactionId: "tx-2" }),
      // No transactionId — a portfolio-scoped reconciliation_gap-style anomaly.
      a({ severity: "warning", code: "reconciliation_gap", scope: "portfolio" }),
    ];
    expect(rowAnomalyCounts(anomalies)).toEqual({ errors: 1, warnings: 1 });
  });

  it("dedupes two anomalies on the same transaction, worst severity wins", () => {
    const anomalies: Anomaly[] = [
      a({ severity: "warning", transactionId: "tx-1" }),
      a({ severity: "error", code: "oversell", transactionId: "tx-1" }),
    ];
    // Same transaction → one row → counted once, as the worse (error) severity.
    expect(rowAnomalyCounts(anomalies)).toEqual({ errors: 1, warnings: 0 });
  });

  it("returns zero counts for an empty list", () => {
    expect(rowAnomalyCounts([])).toEqual({ errors: 0, warnings: 0 });
  });

  // The edge case the code-list partition used to miss entirely: a negative_cash anomaly
  // whose transactionId happens to be undefined (no matching cash-flow row that day) is not
  // instrument/portfolio-scoped by code, but still can't attach to any row.
  it("excludes a transaction-scoped anomaly with an undefined transactionId", () => {
    const anomalies: Anomaly[] = [
      a({
        severity: "error",
        code: "negative_cash",
        scope: "transaction",
        transactionId: undefined,
      }),
    ];
    expect(rowAnomalyCounts(anomalies)).toEqual({ errors: 0, warnings: 0 });
  });
});

describe("bannerAnomalies", () => {
  it("keeps only anomalies with no transactionId", () => {
    const row = a({ severity: "warning", transactionId: "tx-1" });
    const gap = a({ severity: "warning", code: "reconciliation_gap", scope: "portfolio" });
    expect(bannerAnomalies([row, gap])).toEqual([gap]);
  });

  it("is the exact complement of a row-anomaly filter (every anomaly lands in exactly one bucket)", () => {
    const anomalies: Anomaly[] = [
      a({ severity: "warning", transactionId: "tx-1" }),
      a({ severity: "warning", code: "reconciliation_gap", scope: "portfolio" }),
      a({ severity: "warning", code: "position_gap", scope: "portfolio" }),
      a({
        severity: "error",
        code: "negative_cash",
        scope: "transaction",
        transactionId: undefined,
      }),
    ];
    const rows = anomalies.filter(isRowAnomaly);
    const banners = bannerAnomalies(anomalies);
    expect(rows.length + banners.length).toBe(anomalies.length);
    expect(rows).toHaveLength(1);
    expect(banners).toHaveLength(3);
  });
});

describe("formatPercentUnsigned", () => {
  it("formats a magnitude with no sign, unlike the signed formatPercent", () => {
    expect(formatPercent(0.1128, "en")).toBe("+11.28%");
    expect(formatPercentUnsigned(0.1128, "en")).toBe("11.28%");
    expect(formatPercentUnsigned(0.75, "en")).toBe("75.00%");
    expect(formatPercentUnsigned(0, "en")).toBe("0.00%");
  });

  it("follows the locale's separators", () => {
    expect(formatPercentUnsigned(0.1128, "id")).toMatch(/^11,28\s?%$/);
  });
});

describe("formatMoneyWhole", () => {
  it("drops the .00 on a whole amount and keeps real cents", () => {
    expect(formatMoneyWhole(1000, "EUR", "en")).toBe("€1,000");
    expect(formatMoneyWhole(13.33, "EUR", "en")).toBe("€13.33");
    expect(formatMoneyWhole(13.3, "EUR", "en")).toBe("€13.30");
    expect(formatMoneyWhole(0, "EUR", "en")).toBe("€0");
    // Whole at cent precision, even when float arithmetic left a tail.
    expect(formatMoneyWhole(199.99999999999997, "EUR", "en")).toBe("€200");
    expect(formatMoneyWhole(1000 - 800.5, "EUR", "en")).toBe("€199.50");
  });
});
