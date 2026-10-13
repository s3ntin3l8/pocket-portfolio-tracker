import { D, ZERO } from "./decimal.js";

export interface NetWorthPoint {
  date: string;
  netWorth: string;
}

export interface DrawdownResult {
  maxDrawdownPct: string;
  peakDate: string | null;
  troughDate: string | null;
  recoveryDate?: string;
  recoveryDays?: number;
  currentDrawdownPct: string;
}

export function maxDrawdown(series: NetWorthPoint[]): DrawdownResult {
  if (series.length === 0) {
    return { maxDrawdownPct: "0", peakDate: null, troughDate: null, currentDrawdownPct: "0" };
  }

  // A drawdown is measured against a POSITIVE running peak. A non-positive value (an
  // empty portfolio before the first deposit, an index reset to 0, a net-debt day) is
  // not a peak: dividing by it yields NaN (0/0), ±Infinity (x/0) or a sign-flipped
  // ratio (x/negative). Peak tracking therefore starts at the first positive value and
  // the points before it contribute no drawdown (audit B13).
  const firstPositive = series.findIndex((p) => D(p.netWorth).gt(0));
  if (firstPositive === -1) {
    return {
      maxDrawdownPct: "0",
      peakDate: series[0].date,
      troughDate: series[0].date,
      currentDrawdownPct: "0",
    };
  }

  let peak = D(series[firstPositive].netWorth);
  let peakDate = series[firstPositive].date;
  let maxDd = ZERO;
  let maxDdPeakDate = peakDate;
  let maxDdTroughDate = peakDate;
  let peakAtMaxDd = peak; // value at the peak that produced max drawdown

  const lastValue = D(series[series.length - 1].netWorth);

  for (const point of series.slice(firstPositive)) {
    const value = D(point.netWorth);
    if (value.gt(peak)) {
      peak = value;
      peakDate = point.date;
    }
    const dd = value.div(peak).sub(1);
    if (dd.lt(maxDd)) {
      maxDd = dd;
      maxDdPeakDate = peakDate;
      maxDdTroughDate = point.date;
      peakAtMaxDd = peak;
    }
  }

  // `peak` is positive here by construction, so this division is always finite.
  const currentDrawdown = lastValue.div(peak).sub(1);

  if (maxDd.isZero()) {
    return {
      maxDrawdownPct: "0",
      peakDate: series[firstPositive].date,
      troughDate: series[firstPositive].date,
      currentDrawdownPct: currentDrawdown.toString(),
    };
  }

  const peakValue = peakAtMaxDd;
  let recoveryDate: string | undefined;
  for (const point of series) {
    const value = D(point.netWorth);
    if (value.gte(peakValue) && point.date > maxDdTroughDate) {
      recoveryDate = point.date;
      break;
    }
  }

  let recoveryDays: number | undefined;
  if (recoveryDate) {
    const trough = new Date(maxDdTroughDate);
    const recovery = new Date(recoveryDate);
    recoveryDays = Math.round((recovery.getTime() - trough.getTime()) / 86_400_000);
  }

  return {
    maxDrawdownPct: maxDd.toString(),
    peakDate: maxDdPeakDate,
    troughDate: maxDdTroughDate,
    ...(recoveryDate ? { recoveryDate, recoveryDays } : {}),
    currentDrawdownPct: currentDrawdown.toString(),
  };
}
