import { XIRR_MAX_RATE } from "./sanity-gates.js";

export interface CashFlowPoint {
  amount: number | string;
  date: Date;
}

const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365;

interface NormFlow {
  amount: number;
  years: number;
}

function npv(rate: number, flows: NormFlow[]): number {
  return flows.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, f.years), 0);
}

function dNpv(rate: number, flows: NormFlow[]): number {
  return flows.reduce((acc, f) => acc - (f.years * f.amount) / Math.pow(1 + rate, f.years + 1), 0);
}

/**
 * Money-weighted return (XIRR): the annualized rate that makes the net present
 * value of the dated cash flows zero. Newton-Raphson with a bisection fallback.
 * Returns NaN if there isn't at least one inflow and one outflow, or if the
 * converged rate is implausibly large (see `XIRR_MAX_RATE` in sanity-gates).
 */
export function xirr(points: CashFlowPoint[], guess = 0.1): number {
  if (points.length < 2) return NaN;

  const t0 = Math.min(...points.map((p) => p.date.getTime()));
  const flows: NormFlow[] = points.map((p) => ({
    amount: Number(p.amount),
    years: (p.date.getTime() - t0) / MS_PER_YEAR,
  }));

  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) {
    return NaN;
  }

  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate, flows);
    const df = dNpv(rate, flows);
    if (!isFinite(f) || !isFinite(df) || Math.abs(df) < 1e-12) break;
    const next = rate - f / df;
    if (!isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) {
      // #756: Newton-Raphson can converge on a technically-correct but
      // implausibly large rate when the cash-flow history contains a
      // near-zero early contribution followed by a much larger terminal
      // value. Cap at XIRR_MAX_RATE so the all-time XIRR never renders an
      // absurd headline (e.g. +84,214%).
      return Math.abs(next) > XIRR_MAX_RATE ? NaN : next;
    }
    rate = next;
  }

  // Bisection fallback over a wide bracket.
  let lo = -0.999999;
  let hi = 100;
  let flo = npv(lo, flows);
  const fhi = npv(hi, flows);
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return NaN;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid, flows);
    // #756: same cap as the Newton path. This branch fires only when Newton's
    // iteration diverged (derivative underflow, overshoot below -1, or
    // non-finite arithmetic at i=0) AND bisection happened to find the root
    // exactly at `fm ≈ 0` before exhausting its 200 iterations. Keep the cap
    // symmetric with the Newton path so the rate ceiling can't be bypassed
    // by falling through to bisection.
    if (Math.abs(fm) < 1e-9) return Math.abs(mid) > XIRR_MAX_RATE ? NaN : mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  const converged = (lo + hi) / 2;
  // #756: cap on the exhausted-iteration bisection path. Same rationale:
  // a bisection that converged within ±1e-9 on its bracket but couldn't
  // reduce `fm` to under 1e-9 in 200 iterations (rare, but possible for
  // very flat NPV curves near the root) should still respect the cap.
  return Math.abs(converged) > XIRR_MAX_RATE ? NaN : converged;
}
