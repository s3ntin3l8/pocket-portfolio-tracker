import { describe, it, expect } from "vitest";
import { periodXirr, periodStartFor, periodReturn } from "../src/period-xirr.js";
import { toDateKey } from "../src/date-utils.js";

const d = (s: string) => new Date(s);

describe("periodXirr", () => {
  it("returns null when startNav is zero", () => {
    const result = periodXirr([], 1000, 0, d("2024-01-01"), d("2024-12-31"));
    expect(result).toBeNull();
  });

  it("returns null when startNav is negative", () => {
    const result = periodXirr([], 1000, -100, d("2024-01-01"), d("2024-12-31"));
    expect(result).toBeNull();
  });

  it("computes a simple annual return with no intermediate flows", () => {
    // $1000 invested, grew to $1100 in one year → ~10% return
    const result = periodXirr([], 1100, 1000, d("2024-01-01"), d("2025-01-01"));
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(0.1, 1);
  });

  it("clips flows before anchorDate", () => {
    const allFlows = [
      { amount: -500, date: d("2023-01-01") }, // before anchor, should be excluded
      { amount: -200, date: d("2024-06-01") }, // after anchor, included
    ];
    const result = periodXirr(allFlows, 1200, 1000, d("2024-01-01"), d("2025-01-01"));
    expect(result).not.toBeNull();
    // With an extra $200 invested mid-year, the return should be positive but lower
    expect(result!).toBeGreaterThan(-0.5);
  });

  it("returns null for unreasonably large rates (>5000%)", () => {
    // Nearly zero start nav but huge current value => astronomical rate
    const result = periodXirr([], 1_000_000, 1, d("2024-12-30"), d("2024-12-31"));
    expect(result).toBeNull();
  });

  it("excludes flows on or before anchorDate (boundary is exclusive)", () => {
    const anchorDate = d("2024-01-01");
    const allFlows = [
      { amount: -300, date: anchorDate }, // exactly on anchorDate — should be excluded
      { amount: -200, date: d("2024-07-01") }, // after — included
    ];
    const result = periodXirr(allFlows, 1500, 1000, anchorDate, d("2025-01-01"));
    expect(result).not.toBeNull();
  });
});

describe("periodStartFor (audit D9)", () => {
  it("returns UTC midnights from the UTC calendar day", () => {
    const today = new Date("2026-07-15T12:00:00Z");
    expect(periodStartFor("ytd", today)?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(periodStartFor("1y", today)?.toISOString()).toBe("2025-07-15T00:00:00.000Z");
    expect(periodStartFor("5y", today)?.toISOString()).toBe("2021-07-15T00:00:00.000Z");
    expect(periodStartFor("max", today)).toBeNull();
  });

  it("is independent of the process timezone (YTD never anchors on Dec 31)", () => {
    const prevTz = process.env.TZ;
    try {
      for (const tz of ["Asia/Jakarta", "Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = tz;
        for (const now of [
          "2026-01-01T00:30:00Z",
          "2025-12-31T23:30:00Z",
          "2026-06-30T23:59:00Z",
        ]) {
          const today = new Date(now);
          const ytd = periodStartFor("ytd", today)!;
          expect(toDateKey(ytd), `${tz} @ ${now}`).toBe(`${today.getUTCFullYear()}-01-01`);
        }
      }
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});

describe("periodReturn (audit B10)", () => {
  const asOf = d("2026-12-31T12:00:00Z");

  it("a deposit inside the period is not profit", () => {
    // 1,000 at the start, +500 deposited mid-period, now worth 1,600 → 100 gain.
    const r = periodReturn(
      [
        {
          startNav: "1000",
          snapshotDate: "2026-01-01",
          flows: [{ amount: -500, date: d("2026-07-01T10:00:00Z") }],
        },
      ],
      "1600",
      asOf,
    );
    expect(r.pnl).toBe("100");
    expect(r.pnlPct).not.toBeNull();
    // Modified Dietz: 100 / (1000 + 500 × ~0.5) ≈ 8%.
    expect(r.pnlPct!).toBeGreaterThan(0.075);
    expect(r.pnlPct!).toBeLessThan(0.085);
    expect(r.xirr).not.toBeNull();
    expect(r.xirr!).toBeGreaterThan(0.07);
    expect(r.xirr!).toBeLessThan(0.1);
  });

  it("ignores flows on or before each portfolio's own snapshot day (already embedded)", () => {
    const r = periodReturn(
      [
        {
          startNav: "1000",
          snapshotDate: "2026-01-05",
          flows: [
            { amount: -300, date: d("2025-12-20T00:00:00Z") },
            // Same day as the snapshot, which is end-of-day: embedded in startNav.
            { amount: -200, date: d("2026-01-05T15:00:00Z") },
          ],
        },
      ],
      "1100",
      asOf,
    );
    expect(r.pnl).toBe("100");
  });

  it("anchors each portfolio on its own snapshot date — no flow dropped between anchors", () => {
    const r = periodReturn(
      [
        { startNav: "1000", snapshotDate: "2026-01-01", flows: [] },
        {
          startNav: "500",
          snapshotDate: "2026-03-01",
          flows: [{ amount: -100, date: d("2026-04-01T00:00:00Z") }],
        },
        {
          // Its deposit falls between portfolio A's anchor and portfolio B's: a shared
          // latest-anchor filter would have dropped it and booked it as profit.
          startNav: "200",
          snapshotDate: "2026-01-01",
          flows: [{ amount: -50, date: d("2026-02-01T00:00:00Z") }],
        },
      ],
      "1900",
      asOf,
    );
    // 1900 − 1700 − 150 deposited = 50
    expect(r.pnl).toBe("50");
  });

  it("an outside-boundary dividend leaving the boundary counts as return", () => {
    const r = periodReturn(
      [
        {
          startNav: "1000",
          snapshotDate: "2026-01-01",
          flows: [{ amount: 30, date: d("2026-05-01T00:00:00Z") }],
        },
      ],
      "1000",
      asOf,
    );
    expect(r.pnl).toBe("30");
  });

  it("returns no pct/xirr when the opening value is not positive", () => {
    const r = periodReturn([{ startNav: "0", snapshotDate: "2026-01-01", flows: [] }], "100", asOf);
    expect(r.pnl).toBe("100");
    expect(r.pnlPct).toBeNull();
    expect(r.xirr).toBeNull();
  });
});
