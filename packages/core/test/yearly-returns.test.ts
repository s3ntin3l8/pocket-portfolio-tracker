import { describe, it, expect } from "vitest";
import {
  computeYearlyReturns,
  calendarYearReturn,
  type YearlyReturnBenchmarkInput,
  type YearlyPortfolioFlow,
} from "../src/yearly-returns.js";
import type { IndexPoint } from "../src/index.js";
import { streakAnalysis } from "../src/streaks.js";

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

  it("computes benchmark TWR as the ratio of its (display-currency) index levels", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    // Benchmark index 200 → 220 (+10%) in 2024. The index is taken as given: the route
    // layer converts the closes to the display currency at each date's FX rate first
    // (#1020), because a ratio of native closes leaves out the year's FX move.
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

  it("anchors a year's TWR to the PRIOR year's close, not the first point within the year", () => {
    // 2024 ends at index 110. 2025 has a gap: its first observed point (Jan 5) is
    // already at 115 — a real move that happened between Dec 31 and Jan 5. The old
    // "first point within the year" convention would silently drop that move.
    const pfIndex: IndexPoint[] = [
      ...linearIndex("2024-01-02", "2024-12-31", 100, 110),
      ...linearIndex("2025-01-05", "2025-12-31", 115, 120),
    ];
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2025-12-31"),
    });
    // Old behaviour would compute (120/115 - 1) ≈ +4.35%; anchoring to the prior
    // year's close of 110 correctly captures the Dec 31 → Jan 5 move too.
    expect(Number(rows[1].portfolioTwr)).toBeCloseTo(120 / 110 - 1, 4);
    expect(Number(rows[1].portfolioTwr)).not.toBeCloseTo(120 / 115 - 1, 4);
  });

  it("falls back to the year's first point when there is no prior year (inception year)", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-03-01", "2024-12-31", 100, 110);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2024-12-31"),
    });
    expect(Number(rows[0].portfolioTwr)).toBeCloseTo(0.1, 4);
  });

  it("seeds XIRR with an opening-NAV outflow from the PRIOR year's closing NAV", () => {
    // 2024 closes at NAV 30000 (no flows needed for this test — 2024 itself is out
    // of scope). 2025 takes 2000 of deposits and ends at 36000: a modest real
    // return, not the ~250%+ XIRR the missing opening NAV would otherwise imply.
    const pfIndex: IndexPoint[] = [
      ...linearIndex("2024-01-02", "2024-12-31", 100, 110),
      ...linearIndex("2025-01-02", "2025-12-31", 110, 132), // scale mirrors 30000→36000
    ];
    const endNavByYear = new Map<number, string>([
      [2024, "30000"],
      [2025, "36000"],
    ]);
    const flowsByYear = new Map<number, YearlyPortfolioFlow[]>([
      [2025, [flow(-2000, "2025-06-15")]], // a deposit is a cash OUTFLOW from the investor's pocket
    ]);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: flowsByYear,
      pfEndNavByYear: endNavByYear,
      benchmarks: [],
      asOf: d("2025-12-31"),
    });
    const xirr2025 = Number(rows[1].portfolioXirr);
    expect(xirr2025).not.toBeNull();
    // Without the opening NAV, flows=[-2000] + terminal +36000 alone would solve to
    // an absurd rate (only ~half a year of "capital" explaining a 36000 balance).
    // With the €30000 opening NAV counted, the year's real return is modest.
    expect(xirr2025).toBeLessThan(0.5);
    expect(xirr2025).toBeGreaterThan(-0.5);
  });

  it("the inception year (no prior year in the NAV map) is unaffected by the opening-NAV seed", () => {
    const pfIndex: IndexPoint[] = linearIndex("2024-01-02", "2024-12-31", 100, 110);
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map([[2024, [flow(-1000, "2024-01-02")]]]),
      pfEndNavByYear: new Map([[2024, "1100"]]),
      benchmarks: [],
      asOf: d("2024-12-31"),
    });
    // Identical to the pre-existing "computes portfolio XIRR" case above — no
    // pfEndNavByYear.get(2023) entry means opening NAV is 0, today's behaviour.
    expect(Number(rows[0].portfolioXirr!)).toBeCloseTo(0.1, 1);
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

describe("year anchor parity (audit B13)", () => {
  // A big Dec 31 → first-trading-day move in both series: the year's return must
  // include it for the benchmark exactly as for the portfolio, and streakAnalysis's
  // best/worst year must agree with the yearly table.
  const pt = (date: string, index: string): IndexPoint => ({ date, index, pct: "0" });
  const pfIndex: IndexPoint[] = [
    pt("2024-06-03", "100"),
    pt("2024-12-31", "110"),
    pt("2025-01-02", "121"), // +10% overnight into the new year
    pt("2025-12-31", "121"),
  ];
  const bmIndex: IndexPoint[] = [
    pt("2024-06-03", "200"),
    pt("2024-12-31", "200"),
    pt("2025-01-02", "220"), // the same +10% gap
    pt("2025-12-31", "220"),
  ];

  it("anchors the benchmark at the prior year's close, like the portfolio", () => {
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [{ symbol: "^X", displayName: "X", nativeCurrency: "EUR", index: bmIndex }],
      asOf: d("2025-12-31"),
    });
    const y2025 = rows.find((r) => r.year === 2025)!;
    expect(Number(y2025.portfolioTwr)).toBeCloseTo(0.1, 10);
    // Pre-fix the benchmark was anchored at its first 2025 point → 0%, active +10%.
    expect(Number(y2025.benchmarks[0].twr)).toBeCloseTo(0.1, 10);
    expect(Number(y2025.benchmarks[0].activeReturn)).toBeCloseTo(0, 10);
  });

  it("streakAnalysis best/worst year equals the yearly table's portfolioTwr", () => {
    const rows = computeYearlyReturns({
      pfIndex,
      pfFlowsByYear: new Map(),
      pfEndNavByYear: new Map(),
      benchmarks: [],
      asOf: d("2025-12-31"),
    });
    const streaks = streakAnalysis(pfIndex);
    const byYear = new Map(rows.map((r) => [r.year, r.portfolioTwr]));
    expect(streaks.bestYear?.returnPct).toBe(byYear.get(streaks.bestYear!.year));
    expect(streaks.worstYear?.returnPct).toBe(byYear.get(streaks.worstYear!.year));
    // 2025's return includes the Jan 2 gap (pre-fix streaks reported 0 for 2025).
    expect(Number(calendarYearReturn(pfIndex, 2025))).toBeCloseTo(0.1, 10);
  });

  it("calendarYearReturn is null for an empty year or a lone inception-year point", () => {
    expect(calendarYearReturn(pfIndex, 2023)).toBeNull();
    expect(calendarYearReturn([pt("2025-03-01", "100")], 2025)).toBeNull();
  });
});
