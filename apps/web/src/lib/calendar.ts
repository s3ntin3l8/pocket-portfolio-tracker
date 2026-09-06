/**
 * Pure month-grid helper for the income calendar. Produces the 35- or 42-cell grid
 * (5 or 6 weeks of 7 days) for a given `(year, month)`, with each cell identifying
 * whether it belongs to the visible month, the previous-month spillover, or the
 * next-month spillover. All dates are anchored to UTC so the grid is timezone-stable
 * (the rest of the income page works in UTC — see `income-heatmap.tsx` and
 * `income-events-table.tsx`'s `timeZone: "UTC"` formatters — and the YYYY-MM-DD
 * `UpcomingPayment.date` shape the API returns is date-key, not instant).
 */

export interface DayCell {
  /** YYYY-MM-DD, UTC. Identical to `UpcomingPayment.date`, so days can be matched
   *  without re-parsing. */
  dateKey: string;
  /** 1–31 day-of-month — never null; spillover days still surface their day number. */
  dayOfMonth: number;
  /** False for cells that belong to the previous or next month (dimmed rendering). */
  inMonth: boolean;
  /** True when `dateKey === todayKey` (UTC). Used for the today-ring styling. */
  isToday: boolean;
}

export interface MonthGrid {
  /** Localised weekday labels, ordered from week start (Mon for most locales). */
  weekdayLabels: string[];
  /** 35 or 42 cells, in calendar order (left→right, top→bottom). */
  days: DayCell[];
  /** Index (0-based, weekdayLabels-based) of the today cell, or -1 when today
   *  is not in the grid (e.g. current month is several months away). */
  todayIndex: number;
}

/** Resolve the week start [0..6] for a locale. Defaults to Monday (1) when the host
 *  ICU doesn't expose `getWeekInfo` (rare — Node ≥ 22 always does). */
function firstDayOfWeek(locale: string): number {
  try {
    // `getWeekInfo` is part of ICU 73+ / ES2025 but not in the @types/web `lib`
    // that's pinned to ES2022 by this app's tsconfig — narrow-via-cast so we
    // degrade gracefully to a Monday start when the runtime doesn't expose it.
    type LocaleWithWeekInfo = Intl.Locale & {
      getWeekInfo?: () => { weekStart: number; weekend: readonly number[] };
    };
    const info = (new Intl.Locale(locale) as LocaleWithWeekInfo).getWeekInfo?.();
    if (info && typeof info.weekStart === "number") return info.weekStart % 7;
  } catch {
    /* fall through */
  }
  return 1; // Mon
}

/** Pad a 0–9 number to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Build a YYYY-MM-DD key in UTC for the given year/month/day — matches
 *  `toDateKey()` in `packages/core/src/date-utils.ts`. */
function utcDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * Build the month grid for `(year, monthIndex)` (monthIndex is 0-indexed, JS-style).
 *
 * The grid always starts on the week-start (e.g. Monday for en-US/en-GB/id), may
 * include up to 6 rows so a single month can render in 35 or 42 cells, and each
 * cell carries enough metadata to drive styling and date-matching against the
 * `UpcomingPayment[]` passed to the calendar component.
 *
 * `today` defaults to "now" and is treated as a UTC midnight date for `isToday`
 * comparison, so timezone-local "today" doesn't leak into the grid's logic.
 */
export function buildMonthGrid(
  year: number,
  monthIndex: number,
  locale: string,
  today: Date = new Date(),
): MonthGrid {
  const todayKey = `${today.getUTCFullYear()}-${pad2(today.getUTCMonth() + 1)}-${pad2(today.getUTCDate())}`;
  const weekStart = firstDayOfWeek(locale);
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    // Pick a known Sunday so we can shift to whatever weekday is at position `i`
    // relative to the locale's week start. Sunday 2024-01-07 sits at JS getUTCDay=0.
    const dow = (weekStart + i) % 7;
    const ref = new Date(Date.UTC(2024, 0, 7 + dow));
    return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(ref);
  });

  // First-of-month at the visible month's week-start.
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const firstJsDow = firstOfMonth.getUTCDay(); // Sun=0..Sat=6
  // Distance (in days) from the visible month's day 1 back to the week-start cell.
  const offset = (firstJsDow - weekStart + 7) % 7;

  // We render through 6 weeks (42 cells) and trim trailing empty weeks so a short
  // month doesn't end on a 5-row grid when 4 would have been enough. The 6-row max
  // is needed for any month that doesn't start on the week-start day.
  const cells: DayCell[] = [];
  let todayIndex = -1;
  for (let i = 0; i < 42; i += 1) {
    const dayOffset = i - offset;
    const cellDate = new Date(Date.UTC(year, monthIndex, 1 + dayOffset));
    const cellYear = cellDate.getUTCFullYear();
    const cellMonth = cellDate.getUTCMonth();
    const cellDay = cellDate.getUTCDate();
    const dateKey = utcDateKey(cellYear, cellMonth, cellDay);
    const isToday = dateKey === todayKey;
    if (isToday) todayIndex = i;
    cells.push({
      dateKey,
      dayOfMonth: cellDay,
      inMonth: cellMonth === monthIndex,
      isToday,
    });
  }
  // Trim trailing all-out-of-month weeks so short months (Feb, 30-day months that
  // happen to start on the week start) collapse to 28 or 35 cells. We only trim a
  // week when the entire row is out of the visible month.
  while (cells.length > 28) {
    const lastWeek = cells.slice(-7);
    if (lastWeek.every((c) => !c.inMonth)) cells.splice(-7, 7);
    else break;
  }

  return { weekdayLabels, days: cells, todayIndex };
}
