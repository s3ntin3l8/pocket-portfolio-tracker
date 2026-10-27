/**
 * `priceGapRemains` grades the instrument's price series in SQL: the stored window from
 * `fetchFrom` on, the run's candle dates, and the newest stored price before `fetchFrom`
 * as anchor. A hole longer than the carry-forward window — between prices or from the
 * last price to `today` — means the gap remains.
 */
import { describe, it, expect, afterAll } from "vitest";
import { instruments, prices } from "@portfolio/db";
import { MAX_PRICE_CARRY_FORWARD_DAYS } from "@portfolio/core";
import { findGaps } from "@portfolio/market-data";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { priceGapRemains } from "../../src/services/backfill/shared.js";

const DAY = 86_400_000;
const day = (base: string, n: number) =>
  new Date(Date.parse(`${base}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

let seq = 0;
async function seed(stored: string[]) {
  const db = await ensureDb();
  const [instr] = await db
    .insert(instruments)
    .values({
      symbol: `PGS${++seq}`,
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: `Price gap sql ${seq}`,
    })
    .returning();
  if (stored.length > 0) {
    await db
      .insert(prices)
      .values(
        stored.map((date) => ({ instrumentId: instr.id, date, close: "10", currency: "EUR" })),
      );
  }
  return { db, id: instr.id };
}

describe("priceGapRemains (SQL)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("grades the series from the anchor before fetchFrom through the fetched dates", async () => {
    const { db, id } = await seed(["2026-01-01"]);
    // anchor 20 days before the fetch: the hole stays open.
    const fetched = Array.from({ length: 10 }, (_, i) => day("2026-01-21", i));
    expect(await priceGapRemains(db, id, "2026-01-21", fetched, "2026-01-30")).toBe(true);
    // anchor 01-15 → first fetched 01-21 is only 6 days away.
    const { db: db2, id: id2 } = await seed(["2026-01-15"]);
    expect(await priceGapRemains(db2, id2, "2026-01-21", fetched, "2026-01-30")).toBe(false);
  });

  it("detects an interior hole in the stored window", async () => {
    const { db, id } = await seed(["2026-02-01", "2026-02-02", "2026-02-23", "2026-02-24"]);
    expect(await priceGapRemains(db, id, "2026-02-01", [], "2026-02-24")).toBe(true);
  });

  it("detects a trailing stretch longer than the window up to today", async () => {
    const { db, id } = await seed(["2026-03-01"]);
    expect(await priceGapRemains(db, id, "2026-03-01", [], "2026-03-20")).toBe(true);
    expect(await priceGapRemains(db, id, "2026-03-01", [], "2026-03-08")).toBe(false);
  });

  it("does not count days after `today` as a trailing gap", async () => {
    const { db, id } = await seed(["2026-04-01", "2026-04-05"]);
    expect(await priceGapRemains(db, id, "2026-04-01", ["2026-04-30"], "2026-04-10")).toBe(true);
    expect(await priceGapRemains(db, id, "2026-04-01", [], "2026-04-02")).toBe(false);
  });

  it("grades only the trailing rule when stored dates run past `today`", async () => {
    const { db, id } = await seed(["2026-04-20", "2026-04-21"]);
    expect(await priceGapRemains(db, id, "2026-04-20", [], "2026-04-10")).toBe(false);
  });

  it("anchors on the newest pre-fetchFrom row only", async () => {
    // Two old rows 19 days apart must not read as a hole; only the newest one anchors.
    const { db, id } = await seed(["2026-01-01", "2026-01-20"]);
    expect(await priceGapRemains(db, id, "2026-01-21", ["2026-01-22"], "2026-01-25")).toBe(false);
  });

  it("agrees with findGaps over randomized series", async () => {
    let state = 12345;
    const rand = (n: number) => {
      // Math.imul keeps the LCG in 32-bit integers (a plain product loses low bits in float64).
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return (state >>> 8) % n;
    };
    const outcomes = new Set<boolean>();
    for (let k = 0; k < 40; k++) {
      // Alternate dense (1-8 day steps, never a hole) and sparse (1-15 day steps, holes > 10
      // days occur) series, so both answers come up.
      const maxStep = k % 2 === 0 ? 8 : 15;
      const all: string[] = [];
      for (let offset = rand(10); offset < 150; offset += 1 + rand(maxStep)) {
        all.push(day("2026-01-01", offset));
      }
      const newest = all[all.length - 1]!;
      const fetchFrom = day("2026-01-01", rand(100));
      // Mostly at/after the newest price so the trailing rule fires; sometimes before it.
      const today = rand(4) === 0 ? day("2026-01-01", 20 + rand(130)) : day(newest, rand(14));
      const stored = all.filter((_, i) => i % 2 === 0);
      const fetched = all.filter((d, i) => i % 2 === 1 && d >= fetchFrom);
      const { db, id } = await seed(stored);
      const anchor = stored
        .filter((d) => d < fetchFrom)
        .sort()
        .pop();
      const series = [
        ...(anchor ? [anchor] : []),
        ...stored.filter((d) => d >= fetchFrom),
        ...fetched,
      ];
      const expected = findGaps(series, today, MAX_PRICE_CARRY_FORWARD_DAYS).length > 0;
      expect(await priceGapRemains(db, id, fetchFrom, fetched, today), `series ${k}`).toBe(
        expected,
      );
      outcomes.add(expected);
    }
    // The differential must exercise both answers, or it can decay to all-false unnoticed.
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it("is false with no rows and no fetched dates", async () => {
    const { db, id } = await seed([]);
    expect(await priceGapRemains(db, id, "2026-01-01", [], "2026-06-01")).toBe(false);
  });

  it("is false for a 10-year weekday series", async () => {
    const dates: string[] = [];
    for (let i = 0; i < 3650; i++) {
      const d = day("2016-01-01", i);
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (dow !== 0 && dow !== 6) dates.push(d);
    }
    const { db, id } = await seed(dates);
    const last = dates[dates.length - 1]!;
    expect(await priceGapRemains(db, id, "2016-01-01", [], last)).toBe(false);
    // the same series with the fetched side covering today, via candle dates only
    expect(await priceGapRemains(db, id, "2016-01-01", [day(last, 3)], day(last, 3))).toBe(false);
  });
});
