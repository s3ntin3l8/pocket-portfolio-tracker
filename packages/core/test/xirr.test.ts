import { describe, it, expect } from "vitest";
import { xirr, type CashFlowPoint } from "../src/xirr.js";

const d = (s: string) => new Date(s);

describe("xirr — sanity bound (#756)", () => {
  it("returns NaN for a 1-day flow that would converge to ~53x (just over the cap)", () => {
    // -1000 → +1011 in 1 day yields (1011/1000)-1 = 0.011 daily → annualized
    // rate ≈ 53.22, well above XIRR_MAX_RATE (50). The solver converges here
    // (no overflow), but the cap fires and returns NaN.
    const flows: CashFlowPoint[] = [
      { amount: -1000, date: d("2024-01-01") },
      { amount: 1011, date: d("2024-01-02") },
    ];
    const rate = xirr(flows);
    expect(Number.isNaN(rate)).toBe(true);
  });

  it("returns a finite rate for a 1-day flow just below the cap", () => {
    // Just-under-cap twin: -1000 → +1010.6 yields annualized rate ≈ 45.93,
    // below XIRR_MAX_RATE (50). The solver converges to a finite rate — no cap.
    const flows: CashFlowPoint[] = [
      { amount: -1000, date: d("2024-01-01") },
      { amount: 1010.6, date: d("2024-01-02") },
    ];
    const rate = xirr(flows);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeGreaterThan(40);
    expect(rate).toBeLessThan(50);
  });

  it("returns NaN when the cap is exceeded over a multi-year horizon", () => {
    // €0.01 → €100M over 5 years yields an annualized rate ≈ 99
    // ((1+r)^5 = 10^10 → r ≈ 99), well above XIRR_MAX_RATE (50) → NaN.
    const flows: CashFlowPoint[] = [
      { amount: -0.01, date: d("2021-01-01") },
      { amount: 100_000_000, date: d("2026-01-01") },
    ];
    const rate = xirr(flows);
    expect(Number.isNaN(rate)).toBe(true);
  });

  it("exercises the bisection fallback when Newton overshoots below -1", () => {
    // Three flows with two sharing the same date (years=0) make Newton's
    // derivative noisy and overshoot to next = -1.21 on the first iteration,
    // falling through to the bisection fallback. Bisection converges to a
    // rate well below XIRR_MAX_RATE here (the cap doesn't fire, but the
    // bisection code path is exercised). This pins the bisection-mid path
    // stays correct even when Newton can't reach the root.
    const flows: CashFlowPoint[] = [
      { amount: -100, date: d("2024-01-01") },
      { amount: -100, date: d("2024-01-01") },
      { amount: 100, date: d("2025-01-01") },
    ];
    const rate = xirr(flows);
    expect(Number.isFinite(rate)).toBe(true);
    // Flows net -200 in / +100 out: npv = -200 + 100/(1+r), root = -0.5.
    // Newton's derivative noise causes the first iteration to overshoot below -1,
    // falling through to bisection — which converges to the exact root.
    expect(rate).toBeCloseTo(-0.5, 2);
  });

  it("still returns a finite rate for a genuine high-but-plausible return", () => {
    // 5x in 5 years is roughly +38% annualized — well below the cap.
    const flows: CashFlowPoint[] = [
      { amount: -1000, date: d("2021-01-01") },
      { amount: 5000, date: d("2026-01-01") },
    ];
    const rate = xirr(flows);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(1);
  });

  it("still returns a finite rate for a normal annual return (~10%)", () => {
    const flows: CashFlowPoint[] = [
      { amount: -1000, date: d("2024-01-01") },
      { amount: 1100, date: d("2025-01-01") },
    ];
    const rate = xirr(flows);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeCloseTo(0.1, 1);
  });

  it("returns a finite large negative rate for near-total loss", () => {
    // $1M → $1 in a year is a -99.9999% return. The annualized rate is bounded
    // by -1 (i.e. total loss in a single year is exactly -100%), well within
    // the XIRR_MAX_RATE magnitude. This pins that the cap doesn't suppress
    // catastrophic losses — those are still reported, since a real portfolio
    // CAN lose >90% in a year.
    const flows: CashFlowPoint[] = [
      { amount: -1_000_000, date: d("2024-01-01") },
      { amount: 1, date: d("2025-01-01") },
    ];
    const rate = xirr(flows);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeLessThan(-0.5);
  });

  it("returns NaN for fewer than two points (unchanged behavior)", () => {
    expect(Number.isNaN(xirr([]))).toBe(true);
    expect(Number.isNaN(xirr([{ amount: -100, date: d("2024-01-01") }]))).toBe(true);
  });

  it("returns NaN for flows with all-same sign (unchanged behavior)", () => {
    const flows: CashFlowPoint[] = [
      { amount: -100, date: d("2024-01-01") },
      { amount: -200, date: d("2024-06-01") },
    ];
    expect(Number.isNaN(xirr(flows))).toBe(true);
  });
});
