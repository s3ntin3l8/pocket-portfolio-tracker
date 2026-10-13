export interface IndexPoint {
  date: string;
  index: string;
}

export function dailyReturns(points: IndexPoint[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = Number(points[i - 1].index);
    const curr = Number(points[i].index);
    if (prev === 0) {
      result.push(0);
    } else {
      result.push(curr / prev - 1);
    }
  }
  return result;
}

/**
 * The series' actual sampling frequency, in periods per year: `(N − 1)` return periods
 * over the calendar span between the first and last point. Portfolio snapshot series are
 * calendar-daily (weekends and holidays included), so annualizing them with the
 * trading-day constant 252 understates volatility (audit B13) — this derives the factor
 * from the data instead, so it is right for a calendar-daily (~365), a trading-day (~252)
 * or a monthly (~12) series alike. Returns null when the span is zero or there are fewer
 * than two points (no periods to measure).
 */
export function periodsPerYear(points: IndexPoint[]): number | null {
  if (points.length < 2) return null;
  const first = Date.parse(points[0].date);
  const last = Date.parse(points[points.length - 1].date);
  const spanDays = (last - first) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays <= 0) return null;
  return (points.length - 1) / (spanDays / 365.25);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  const mu = mean(values);
  const sqDiffs = values.map((v) => (v - mu) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

function annualizedReturn(dailyRets: number[], periodsPerYear: number): number {
  const totalReturn = dailyRets.reduce((acc, r) => acc * (1 + r), 1);
  const n = dailyRets.length;
  return Math.pow(totalReturn, periodsPerYear / n) - 1;
}

export function annualizedVolatility(returns: number[], periodsPerYear = 252): number | null {
  if (returns.length < 2) return null;
  return stddev(returns) * Math.sqrt(periodsPerYear);
}

export function sharpeRatio(
  returns: number[],
  riskFreeRate: number,
  periodsPerYear = 252,
): number | null {
  if (returns.length < 2) return null;
  const annVol = annualizedVolatility(returns, periodsPerYear);
  if (annVol === null || annVol === 0) return null;
  const annRet = annualizedReturn(returns, periodsPerYear);
  return (annRet - riskFreeRate) / annVol;
}

/**
 * Annualized downside deviation (target 0): `sqrt(Σ min(r, 0)² / N) · √periodsPerYear`,
 * where N is the FULL number of periods — positive periods contribute 0 to the sum but
 * still count in the denominator. Dividing by the number of negative periods only (the
 * pre-audit-B13 shape) overstates downside risk whenever the series has few down days,
 * deflating Sortino. Returns 0 when there is no downside at all (→ Sortino undefined).
 */
function downsideDeviation(returns: number[], periodsPerYear: number): number {
  if (returns.length === 0) return 0;
  const sumSq = returns.reduce((acc, r) => (r < 0 ? acc + r * r : acc), 0);
  if (sumSq === 0) return 0;
  return Math.sqrt(sumSq / returns.length) * Math.sqrt(periodsPerYear);
}

export function sortinoRatio(
  returns: number[],
  riskFreeRate: number,
  periodsPerYear = 252,
): number | null {
  if (returns.length < 2) return null;
  const annRet = annualizedReturn(returns, periodsPerYear);
  const dd = downsideDeviation(returns, periodsPerYear);
  if (dd === 0) return null;
  return (annRet - riskFreeRate) / dd;
}
