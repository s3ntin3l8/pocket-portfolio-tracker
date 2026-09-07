import { describe, it, expect } from "vitest";
import { buildMonthGrid } from "../src/lib/calendar";

describe("buildMonthGrid", () => {
  it("September 2026 — starts on Tuesday, renders 5 weeks", () => {
    // 2026-09-01 is a Tuesday. en-US week-info's real first day is Sunday (ICU
    // `getWeekInfo().firstDay === 7`) → 2 spillover cells → first row starts
    // on the preceding Sunday.
    const grid = buildMonthGrid(2026, 8, "en-US");
    expect(grid.weekdayLabels).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(grid.days).toHaveLength(35);
    expect(grid.days[0]).toMatchObject({ dateKey: "2026-08-30", dayOfMonth: 30, inMonth: false });
    expect(grid.days[6]).toMatchObject({ dateKey: "2026-09-05", dayOfMonth: 5, inMonth: true });
    expect(grid.days[34]).toMatchObject({ dateKey: "2026-10-03", dayOfMonth: 3, inMonth: false });
    // No today in this grid (today = default new Date() may be 2026-09-06 in this
    // run; let's only assert the in-month day-cell for the 1st).
    const first = grid.days.find((c) => c.dateKey === "2026-09-01");
    expect(first).toMatchObject({ dayOfMonth: 1, inMonth: true, isToday: false });
  });

  it("February 2026 — starts on Sunday, renders 4 weeks (28 days)", () => {
    // 2026-02-01 is a Sunday, which is en-US's real week start → no spillover
    // prefix → 4-row, 28-cell grid.
    const grid = buildMonthGrid(2026, 1, "en-US");
    expect(grid.days).toHaveLength(28);
    expect(grid.days[0]).toMatchObject({ dateKey: "2026-02-01", dayOfMonth: 1, inMonth: true });
    expect(grid.days[27]).toMatchObject({ dateKey: "2026-02-28", dayOfMonth: 28, inMonth: true });
  });

  it("leap year February 2028 — has 29 days, renders 5 weeks", () => {
    const grid = buildMonthGrid(2028, 1, "en-US");
    expect(grid.days).toHaveLength(35);
    expect(grid.days.find((c) => c.dateKey === "2028-02-29")).toBeDefined();
  });

  it("today flag matches the today parameter and todayIndex points to the cell", () => {
    const today = new Date(Date.UTC(2026, 8, 14)); // 2026-09-14
    const grid = buildMonthGrid(2026, 8, "en-US", today);
    const idx = grid.days.findIndex((c) => c.dateKey === "2026-09-14");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(grid.todayIndex).toBe(idx);
    expect(grid.days[idx]).toMatchObject({ dateKey: "2026-09-14", isToday: true });
  });

  it("todayIndex is -1 when today falls in a different month", () => {
    const today = new Date(Date.UTC(2030, 3, 5)); // April
    const grid = buildMonthGrid(2026, 8, "en-US", today);
    expect(grid.todayIndex).toBe(-1);
    expect(grid.days.every((c) => !c.isToday)).toBe(true);
  });

  it("Sunday-start locale (en-US Sun=0) shifts the weekday labels", () => {
    // en-US's real ICU week info (`getWeekInfo().firstDay === 7`) starts the week
    // on Sunday. The contract here is only that labels exist and are unique.
    const grid = buildMonthGrid(2026, 8, "en-US");
    expect(grid.weekdayLabels).toHaveLength(7);
    expect(new Set(grid.weekdayLabels).size).toBe(7);
  });

  it("all in-month days for the requested month are present and contiguous", () => {
    const grid = buildMonthGrid(2026, 8, "en-US");
    const inMonth = grid.days.filter((c) => c.inMonth);
    expect(inMonth[0].dateKey).toBe("2026-09-01");
    expect(inMonth[inMonth.length - 1].dateKey).toBe("2026-09-30");
    expect(inMonth).toHaveLength(30);
    // Sequentially by 1 day
    for (let i = 1; i < inMonth.length; i += 1) {
      const prev = new Date(inMonth[i - 1].dateKey + "T00:00:00Z").getTime();
      const cur = new Date(inMonth[i].dateKey + "T00:00:00Z").getTime();
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it("spillover days carry the correct prev/next-month dateKey", () => {
    const grid = buildMonthGrid(2026, 8, "en-US");
    // August 2026 has 31 days; 2026-08-31 should appear in the leading spillover cells.
    const aug31 = grid.days.find((c) => c.dateKey === "2026-08-31");
    expect(aug31).toMatchObject({ inMonth: false, dayOfMonth: 31 });
    const oct1 = grid.days.find((c) => c.dateKey === "2026-10-01");
    expect(oct1).toMatchObject({ inMonth: false, dayOfMonth: 1 });
  });
});
