import { describe, it, expect } from "vitest";
import {
  computeYearlyReturns,
  type YearlyReturnBenchmarkInput,
  type YearlyPortfolioFlow,
} from "../src/yearly-returns.js";
import type { IndexPoint } from "../src/index.js";

const d = (s: string) => new Date(s);

const flow = (amount: number | string, date: string): YearlyPortfolioFlow => ({
  amount: String(amount),
  date: d(date),
});

// Helper: build a daily IndexPoint series in a year, growing/shrinking by a fixed daily rate.
function linearIndex(
  startDate: string,
  endDate: string,
  startIndex: number,
  endIndex: number,
): IndexPoint[] {
  const out: IndexPoint[] = [];
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endDate}T00:00:00Z`);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const step = (endIndex - startIndex) / Math.max(1, days - 1);
  for (let i = 0; i < days; i++) {
    const t = new Date(s.getTime() + i * 24 * 60 * 60 * 1000);
    const v = startIndex + step * i;
    const pct = (v / 100 - 1) * 100;
    out.push({ date: t.toISOString().slice(0, 10), index: v.toString(), pct: pct.toString() });
  }
  return out;
}

describe("computeYearlyReturns", () => {
  it("returns an empty array when no index has any data", () => {
    const rows = computeYearlyReturns({
      pfIndex: [],
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2026-09-07"),
    });
    expect(rows).toEqual([]);
  });

  it("emits one row per year present in the portfolio index, oldest → newest", () => {
    const pfIndex: IndexPoint[] = [
      ...linearIndex("2024-01-02", "2024-12-31", 100, 110),
      ...linearIndex("2025-01-02", "2025-12-31", 110, 121),
      ...linearIndex("2026-01-02", "2026-09-07", 121, 125),
    ];
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2026-09-07"),
    });
    expect(rows.map((r) => r.year)).toEqual([2024, 2025, 2026]);
    expect(rows.map((r) => r.isCurrentYear)).toEqual([false, false, true]);
  });

  it("computes portfolio TWR per year from the chained index endpoints", () => {
    // 2024: 100 → 110 = +10%
    // 2025: 110 → 121 = +10%
    const pfIndex: IndexPoint[] = [
      ...linearIndex("2024-01-02", "2024-12-31", 100, 110),
      ...linearIndex("2025-01-02", "2025-12-31", 110, 121),
    ];
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2025-12-31"),
    });
    // pct strings are returned as fractions (× 1, not × 100). 10% = 0.10
    expect(Number(rows[0].portfolioTwr)).toBeCloseTo(0.1, 4);
    expect(Number(rows[1].portfolioTwr)).toBeCloseTo(0.1, 4);
  });

  it("returns null for a year the portfolio does not span", () => {
    // Portfolio only exists in 2024. Ask for rows that include 2023 (pre-history).
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2024-12-31"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].year).toBe(2024);
    expect(rows[0].portfolioTwr).not.toBeNull();
  });

  it("computes benchmark TWR (ratio-based, currency-invariant)", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    // Benchmark in native EUR: 200 → 220 (+10%) in 2024. TWR is ratio-based so
    // it's the same regardless of native/display currency; the route layer is
    // responsible for any pre-conversion if needed.
    const bmIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 200, 220);
    const benchmarks: YearlyReturnBenchmarkInput[] = [
      { symbol: "^GDAXI", displayName: "DAX", nativeCurrency: "EUR", index: bmIndex },
    ];
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks,
      asOf: d("2024-12-31"),
    });
    expect(rows).toHaveLength(1);
    const bm = rows[0].benchmarks[0];
    expect(bm.symbol).toBe("^GDAXI");
    expect(Number(bm.twr)).toBeCloseTo(0.1, 4);
  });

  it("computes active return as portfolioTWR − benchmarkTWR", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 115); // +15%
    const bmIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 200, 210); // +5%
    const benchmarks: YearlyReturnBenchmarkInput[] = [
      { symbol: "^GSPC", displayName: "S&P 500", nativeCurrency: "USD", index: bmIndex },
    ];
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks,
      asOf: d("2024-12-31"),
    });
    expect(Number(rows[0].benchmarks[0].activeReturn)).toBeCloseTo(0.1, 4);
  });

  it("returns null twr/activeReturn for years with no benchmark data, but still emits the row", () => {
    const pfIndex: IndexPoint[] = [
      ...linearIndex("2024-01-02", "2024-12-31", 100, 110),
      ...linearIndex("2025-01-02", "2025-12-31", 110, 121),
    ];
    // Benchmark only has 2024 data.
    const bmIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 105);
    const benchmarks: YearlyReturnBenchmarkInput[] = [
      { symbol: "^GSPC", displayName: "S&P 500", nativeCurrency: "USD", index: bmIndex },
    ];
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks,
      asOf: d("2025-12-31"),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].benchmarks[0].twr).not.toBeNull();
    expect(rows[1].benchmarks[0].twr).toBeNull();
    expect(rows[1].benchmarks[0].activeReturn).toBeNull();
  });

  it("computes portfolio XIRR per year from the flows map and end NAV", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    // $1000 invested on Jan 2, $1100 on Dec 31 → ~10% XIRR.
    const flowsByYear = new Map<number, YearlyPortfolioFlow[]>([
      [2024, [flow(-1000, "2024-01-02")]],
    ]);
    const endNavByYear = new Map<number, string>([[2024, "1100"]]);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: flowsByYear,
      pfEndNavByYear: endNavByYear,
      benchmarks: [],
      asOf: d("2024-12-31"),
    });
    expect(rows[0].portfolioXirr).not.toBeNull();
    expect(Number(rows[0].portfolioXirr!)).toBeCloseTo(0.1, 1);
  });

  it("returns null XIRR when the year has no boundary flows", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map([[2024, "1100"]]),
      benchmarks: [],
      asOf: d("2024-12-31"),
    });
    expect(rows[0].portfolioXirr).toBeNull();
  });

  it("returns null XIRR when the year has no end NAV", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map([[2024, [flow(-1000, "2024-01-02")]]]),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2024-12-31"),
    });
    expect(rows[0].portfolioXirr).toBeNull();
  });

  it("marks the current calendar year (matches asOf.getUTCFullYear) as isCurrentYear", () => {
    const pfIndex: IndexPoint[] = [
      ...linearIndex("2024-01-02", "2024-12-31", 100, 110),
      ...linearIndex("2025-01-02", "2025-12-31", 110, 121),
    ];
    const rows2024 = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2024-07-15"),
    });
    expect(rows2024.find((r) => r.year === 2024)?.isCurrentYear).toBe(true);
    expect(rows2024.find((r) => r.year === 2025)?.isCurrentYear).toBe(false);

    const rows2025 = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2025-07-15"),
    });
    expect(rows2025.find((r) => r.year === 2024)?.isCurrentYear).toBe(false);
    expect(rows2025.find((r) => r.year === 2025)?.isCurrentYear).toBe(true);
  });
});
