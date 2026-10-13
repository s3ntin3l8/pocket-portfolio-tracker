import { calendarYearReturn } from "./yearly-returns.js";

export interface IndexPoint {
  date: string;
  index: string;
}

export interface Streak {
  length: number;
  totalReturnPct: string;
  start: string;
  end: string;
}

export interface StreakResult {
  bestStreak: Streak | null;
  worstStreak: Streak | null;
  bestMonth: { date: string; returnPct: string } | null;
  worstMonth: { date: string; returnPct: string } | null;
  bestYear: { year: number; returnPct: string } | null;
  worstYear: { year: number; returnPct: string } | null;
  positiveMonths: number;
  negativeMonths: number;
  totalMonths: number;
}

/**
 * Resample a (possibly daily) index series down to one point per calendar month — the
 * last point on or before each month's end. Always rebuilds the series (it's a real
 * grouping pass, not a short-circuit); the rebuild is only *observably* an identity map
 * when the input already has exactly one point per month (each point is already the
 * sole entry for its month, so it's kept as-is). Callers may pass either such
 * genuinely-monthly points, or a daily TWR index (the real-world case, e.g. from
 * `chainIndex`) — either way the streaks below are computed over true calendar months,
 * not raw series points.
 */
function monthEndPoints(points: IndexPoint[]): IndexPoint[] {
  const byMonth = new Map<string, IndexPoint>();
  for (const p of points) {
    byMonth.set(p.date.slice(0, 7), p); // points are date-ascending → last write wins
  }
  return [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, p]) => p);
}

function monthlyReturns(points: IndexPoint[]): { date: string; returnPct: number }[] {
  const months = monthEndPoints(points);
  const result: { date: string; returnPct: number }[] = [];
  for (let i = 1; i < months.length; i++) {
    const prev = Number(months[i - 1].index);
    const curr = Number(months[i].index);
    const ret = prev !== 0 ? curr / prev - 1 : 0;
    result.push({ date: months[i].date, returnPct: ret });
  }
  return result;
}

export function streakAnalysis(points: IndexPoint[]): StreakResult {
  const months = monthlyReturns(points);

  let bestStreak: Streak | null = null;
  let worstStreak: Streak | null = null;
  let positiveMonths = 0;
  let negativeMonths = 0;

  let i = 0;
  while (i < months.length) {
    const isPositive = months[i].returnPct >= 0;
    let j = i;
    let compoundReturn = 1;
    while (j < months.length && months[j].returnPct >= 0 === isPositive) {
      compoundReturn *= 1 + months[j].returnPct;
      j++;
    }
    const length = j - i;
    const totalReturn = compoundReturn - 1;

    if (isPositive) {
      positiveMonths += length;
      if (!bestStreak || length > bestStreak.length) {
        bestStreak = {
          length,
          totalReturnPct: String(totalReturn),
          start: months[i].date,
          end: months[j - 1].date,
        };
      }
    } else {
      negativeMonths += length;
      if (!worstStreak || length > worstStreak.length) {
        worstStreak = {
          length,
          totalReturnPct: String(totalReturn),
          start: months[i].date,
          end: months[j - 1].date,
        };
      }
    }
    i = j;
  }

  let bestMonth: { date: string; returnPct: string } | null = null;
  let worstMonth: { date: string; returnPct: string } | null = null;
  for (const m of months) {
    if (!bestMonth || m.returnPct > Number(bestMonth.returnPct)) {
      bestMonth = { date: m.date.slice(0, 7), returnPct: String(m.returnPct) };
    }
    if (!worstMonth || m.returnPct < Number(worstMonth.returnPct)) {
      worstMonth = { date: m.date.slice(0, 7), returnPct: String(m.returnPct) };
    }
  }

  // Best/worst calendar year use the SAME definition as the yearly-returns table —
  // anchored at the prior year's close, inception year from its first point — so the
  // streaks card and the yearly table never report different numbers for one year
  // (audit B13). A year with no computable return (a lone inception-year point) is skipped.
  const years = [...new Set(points.map((p) => Number(p.date.slice(0, 4))))].sort((a, b) => a - b);

  let bestYear: { year: number; returnPct: string } | null = null;
  let worstYear: { year: number; returnPct: string } | null = null;
  for (const year of years) {
    const yr = calendarYearReturn(points, year);
    if (yr === null) continue;
    const ret = Number(yr);
    if (!bestYear || ret > Number(bestYear.returnPct)) {
      bestYear = { year, returnPct: yr };
    }
    if (!worstYear || ret < Number(worstYear.returnPct)) {
      worstYear = { year, returnPct: yr };
    }
  }

  return {
    bestStreak,
    worstStreak,
    bestMonth,
    worstMonth,
    bestYear,
    worstYear,
    positiveMonths,
    negativeMonths,
    totalMonths: months.length,
  };
}
