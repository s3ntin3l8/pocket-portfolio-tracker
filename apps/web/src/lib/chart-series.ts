import type { PerformancePoint } from "@portfolio/api-client";

/**
 * A single point in the merged contributions-vs-value overlay series.
 * `contributed` is the cumulative cash crossing the portfolio boundary up to
 * this date; `value` is the mark-to-market portfolio value on this date.
 */
export interface ContributionValuePoint {
  date: string;
  contributed: number;
  value: number;
}

/**
 * Merge a monthly net-contribution series with a daily portfolio-value history
 * into a single daily series suitable for the overlay chart.
 *
 * Algorithm:
 * - Build a cumulative-by-month map from the per-month net deltas (same prefix
 *   sum previously inlined in ContributionsChart, but keyed by "YYYY-MM").
 * - For each day in `valueHistory`, forward-fill the cumulative contribution
 *   using the month of that day.
 *
 * Returns an empty array when `valueHistory` has fewer than 2 points so callers
 * can fall back to the degraded single-series path.
 */
export function mergeContributionValue(
  series: { month: string; contributed: string }[],
  valueHistory: PerformancePoint[],
): ContributionValuePoint[] {
  if (valueHistory.length < 2) return [];

  // Build month → cumulative-contribution map (ascending).
  const cumByMonth = new Map<string, number>();
  let running = 0;
  const sorted = [...series].sort((a, b) => a.month.localeCompare(b.month));
  for (const s of sorted) {
    running += Number(s.contributed);
    cumByMonth.set(s.month, running);
  }

  // Build a sorted list of [month, cumulative] for forward-fill lookup.
  const monthEntries = Array.from(cumByMonth.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  /**
   * Return the cumulative contribution as of a given date by looking up its
   * "YYYY-MM" key in the map, or forward-filling the last known value for
   * months that had no contribution activity, or 0 before the first entry.
   */
  function cumulativeAt(date: string): number {
    const month = date.slice(0, 7); // "YYYY-MM"
    // Exact match is the fast path.
    if (cumByMonth.has(month)) return cumByMonth.get(month)!;
    // Forward-fill: find the last entry ≤ this month.
    let last = 0;
    for (const [m, v] of monthEntries) {
      if (m <= month) last = v;
      else break;
    }
    return last;
  }

  return valueHistory.map((p) => ({
    date: p.date,
    contributed: cumulativeAt(p.date),
    value: Number(p.netWorth),
  }));
}
