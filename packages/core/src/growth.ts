import type { Decimal } from "decimal.js";

export function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export function addUTCMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function inferIntervalMonths(dates: Date[]): number {
  if (dates.length < 2) return 12;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const spacings: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const m = monthsBetween(sorted[i - 1], sorted[i]);
    if (m >= 1 && m <= 14) spacings.push(m);
  }
  if (spacings.length === 0) return 12;
  const avg = spacings.reduce((s, x) => s + x, 0) / spacings.length;
  if (avg <= 1.5) return 1;
  if (avg <= 4.5) return 3;
  if (avg <= 9) return 6;
  return 12;
}

export const MIN_PAYMENTS_FOR_GROWTH = 2;

export function computeGrowthFactor(
  perShareAmounts: { date: Date; perShare: Decimal }[],
  now: Date,
): number {
  const cutoff12mo = addUTCMonths(now, -12);
  const cutoff24mo = addUTCMonths(now, -24);

  const trailingAmts = perShareAmounts
    .filter((p) => p.date > cutoff12mo && p.date <= now)
    .map((p) => p.perShare.toNumber());
  const priorAmts = perShareAmounts
    .filter((p) => p.date > cutoff24mo && p.date <= cutoff12mo)
    .map((p) => p.perShare.toNumber());

  if (trailingAmts.length < MIN_PAYMENTS_FOR_GROWTH || priorAmts.length < MIN_PAYMENTS_FOR_GROWTH) {
    return 1.0;
  }

  const withoutOneOffs = (amounts: number[]): number[] => {
    if (amounts.length === 0) return [];
    const sorted = [...amounts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return amounts.filter((a) => median <= 0 || a <= 2 * median);
  };

  const mean = (amounts: number[]): number =>
    amounts.length > 0 ? amounts.reduce((s, x) => s + x, 0) / amounts.length : 0;

  const trailingMean = mean(withoutOneOffs(trailingAmts));
  const priorMean = mean(withoutOneOffs(priorAmts));

  if (priorMean <= 0 || trailingMean <= 0) return 1.0;
  return Math.min(2.0, Math.max(0.5, trailingMean / priorMean));
}
