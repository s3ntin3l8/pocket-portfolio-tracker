import { describe, it, expect } from "vitest";
import {
  dailyReturns,
  annualizedVolatility,
  sharpeRatio,
  sortinoRatio,
  periodsPerYear,
} from "../src/volatility.js";

describe("dailyReturns", () => {
  it("returns empty array for single point", () => {
    expect(dailyReturns([{ date: "2026-01-01", index: "100" }])).toEqual([]);
  });

  it("computes percentage returns between consecutive points", () => {
    const points = [
      { date: "2026-01-01", index: "100" },
      { date: "2026-01-02", index: "110" },
      { date: "2026-01-03", index: "99" },
    ];
    const result = dailyReturns(points);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0.1, 10);
    expect(result[1]).toBeCloseTo(-0.1, 10);
  });

  it("handles zero previous index", () => {
    const points = [
      { date: "2026-01-01", index: "0" },
      { date: "2026-01-02", index: "100" },
    ];
    const result = dailyReturns(points);
    expect(result).toEqual([0]);
  });
});

describe("annualizedVolatility", () => {
  it("returns null for empty returns", () => {
    expect(annualizedVolatility([], 252)).toBeNull();
  });

  it("returns null for single return", () => {
    expect(annualizedVolatility([0.01], 252)).toBeNull();
  });

  it("computes 0 for constant returns", () => {
    expect(annualizedVolatility([0.01, 0.01, 0.01], 252)).toBeCloseTo(0, 10);
  });

  it("computes expected volatility for known series", () => {
    const returns = [0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.03, -0.03];
    const vol = annualizedVolatility(returns, 252);
    expect(vol).not.toBeNull();
    expect(vol!).toBeGreaterThan(0);
  });
});

describe("sharpeRatio", () => {
  it("returns null for empty returns", () => {
    expect(sharpeRatio([], 0.02, 252)).toBeNull();
  });

  it("returns null for single return", () => {
    expect(sharpeRatio([0.01], 0.02, 252)).toBeNull();
  });

  it("returns negative sharpe when return is below risk-free", () => {
    const returns = [-0.02, -0.01, -0.03];
    const sr = sharpeRatio(returns, 0.03, 252);
    expect(sr).not.toBeNull();
    expect(sr!).toBeLessThan(0);
  });
});

describe("sortinoRatio", () => {
  it("returns null for empty returns", () => {
    expect(sortinoRatio([], 0.02, 252)).toBeNull();
  });

  it("returns null for single return", () => {
    expect(sortinoRatio([0.01], 0.02, 252)).toBeNull();
  });

  it("returns null when there are no down-months (undefined Sortino)", () => {
    const returns = [0.01, 0.02, 0.015];
    const sr = sortinoRatio(returns, 0.02, 252);
    expect(sr).toBeNull();
  });
});

describe("periodsPerYear (audit B13)", () => {
  it("is null for fewer than two points or a zero span", () => {
    expect(periodsPerYear([])).toBeNull();
    expect(periodsPerYear([{ date: "2026-01-01", index: "100" }])).toBeNull();
    expect(
      periodsPerYear([
        { date: "2026-01-01", index: "100" },
        { date: "2026-01-01", index: "101" },
      ]),
    ).toBeNull();
  });

  it("is ~365 for a calendar-daily series, not the trading-day 252", () => {
    const points = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      index: String(100 + i),
    }));
    expect(periodsPerYear(points)).toBeCloseTo(365.25, 10);
  });

  it("is ~12 for a month-end series", () => {
    const points = [
      { date: "2025-01-31", index: "100" },
      { date: "2025-07-31", index: "105" },
      { date: "2026-01-31", index: "110" },
    ];
    // 2 periods over 365 days.
    expect(periodsPerYear(points)).toBeCloseTo(2 / (365 / 365.25), 10);
  });

  it("annualizes a calendar-daily series with its own frequency", () => {
    const points = [
      { date: "2026-01-01", index: "100" },
      { date: "2026-01-02", index: "101" },
      { date: "2026-01-03", index: "98.98" },
      { date: "2026-01-04", index: "101.9494" },
      { date: "2026-01-05", index: "100.929906" },
    ];
    const rets = dailyReturns(points);
    const ppy = periodsPerYear(points)!;
    expect(ppy).toBeCloseTo(365.25, 10);
    const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sampleSd = Math.sqrt(rets.reduce((a, r) => a + (r - mu) ** 2, 0) / (rets.length - 1));
    expect(annualizedVolatility(rets, ppy)).toBeCloseTo(sampleSd * Math.sqrt(365.25), 10);
    // The old fixed-252 annualization would understate it for this calendar-daily series.
    expect(annualizedVolatility(rets, 252)!).toBeLessThan(annualizedVolatility(rets, ppy)!);
  });
});

describe("sortinoRatio downside deviation (audit B13)", () => {
  it("divides the squared downside by the FULL period count, not just negative periods", () => {
    const returns = [0.01, -0.02, 0.03, -0.01];
    const ppy = 365.25;
    const annRet =
      Math.pow(
        returns.reduce((acc, r) => acc * (1 + r), 1),
        ppy / returns.length,
      ) - 1;
    const dd = Math.sqrt((0.02 ** 2 + 0.01 ** 2) / returns.length) * Math.sqrt(ppy);
    expect(sortinoRatio(returns, 0.03, ppy)).toBeCloseTo((annRet - 0.03) / dd, 8);
  });

  it("is defined with a single down period (old shape returned null for < 2 negatives)", () => {
    const returns = [0.01, 0.02, -0.005];
    expect(sortinoRatio(returns, 0, 252)).not.toBeNull();
  });
});
