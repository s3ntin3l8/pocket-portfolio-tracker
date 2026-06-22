import { describe, it, expect } from "vitest";
import { mergeContributionValue } from "../src/lib/chart-series";
import type { PerformancePoint } from "@portfolio/api-client";

const series = [
  { month: "2026-01", contributed: "100" },
  { month: "2026-02", contributed: "200" },
  { month: "2026-04", contributed: "50" }, // gap: no March entry
];

const history: PerformancePoint[] = [
  { date: "2026-01-15", netWorth: "80" },
  { date: "2026-01-31", netWorth: "105" },
  { date: "2026-02-28", netWorth: "310" },
  { date: "2026-03-15", netWorth: "295" }, // month with no contribution entry
  { date: "2026-04-30", netWorth: "360" },
];

describe("mergeContributionValue", () => {
  it("returns [] when valueHistory has fewer than 2 points", () => {
    expect(mergeContributionValue(series, [])).toEqual([]);
    expect(
      mergeContributionValue(series, [{ date: "2026-01-01", netWorth: "100" }]),
    ).toEqual([]);
  });

  it("preserves all daily value history points in output", () => {
    const result = mergeContributionValue(series, history);
    expect(result).toHaveLength(history.length);
    result.forEach((p, i) => {
      expect(p.date).toBe(history[i].date);
    });
  });

  it("maps netWorth to value correctly", () => {
    const result = mergeContributionValue(series, history);
    expect(result[0].value).toBe(80);
    expect(result[4].value).toBe(360);
  });

  it("computes cumulative contributions by month (prefix sum)", () => {
    const result = mergeContributionValue(series, history);
    // Jan 15 and Jan 31 → cumulative through Jan = 100
    expect(result[0].contributed).toBe(100);
    expect(result[1].contributed).toBe(100);
    // Feb 28 → cumulative through Feb = 100 + 200 = 300
    expect(result[2].contributed).toBe(300);
  });

  it("forward-fills contributed for months with no contribution entry (March gap)", () => {
    const result = mergeContributionValue(series, history);
    // March has no contribution entry → forward-fill Feb cumulative = 300
    expect(result[3].contributed).toBe(300);
  });

  it("picks up the April contribution at the Apr-30 point", () => {
    const result = mergeContributionValue(series, history);
    // Apr cumulative = 100 + 200 + 50 = 350
    expect(result[4].contributed).toBe(350);
  });

  it("returns 0 contributed for dates before the first contribution month", () => {
    const earlyHistory: PerformancePoint[] = [
      { date: "2025-12-01", netWorth: "50" },
      { date: "2025-12-31", netWorth: "60" },
    ];
    const result = mergeContributionValue(series, earlyHistory);
    expect(result[0].contributed).toBe(0);
    expect(result[1].contributed).toBe(0);
  });

  it("handles an empty contribution series (everything is zero contribution)", () => {
    const result = mergeContributionValue([], history);
    expect(result).toHaveLength(history.length);
    result.forEach((p) => expect(p.contributed).toBe(0));
  });

  it("handles unsorted series input by sorting it", () => {
    const unsorted = [
      { month: "2026-02", contributed: "200" },
      { month: "2026-01", contributed: "100" },
    ];
    const result = mergeContributionValue(unsorted, history);
    // Jan points should have cumulative 100, Feb should have 300
    expect(result[0].contributed).toBe(100);
    expect(result[2].contributed).toBe(300);
  });
});
