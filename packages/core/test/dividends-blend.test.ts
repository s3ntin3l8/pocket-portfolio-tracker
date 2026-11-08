import { describe, it, expect } from "vitest";
import { blendAnnouncedDividends, dividendIntervalMonths, type IncomeEntry } from "../src/index.js";

const proj = (instrumentId: string, date: string) => ({ instrumentId, date });
const quarterly = () => 3;
// Quarterly cadence: tolerance is floor(3 * 30 / 2) = 45 days.
const Q = ["2027-01-12", "2027-04-12", "2027-07-12", "2027-10-12"].map((x) => proj("A", x));

describe("blendAnnouncedDividends", () => {
  it("replaces only the covered slot and keeps the rest of the cadence", () => {
    const out = blendAnnouncedDividends(Q, [{ instrumentId: "A", date: "2027-01-20" }], quarterly);
    expect(out.map((p) => p.date)).toEqual(["2027-04-12", "2027-07-12", "2027-10-12"]);
  });

  it("keeps everything when the announced row is 2+ months from every slot", () => {
    // Mar/Jun/Sep/Dec cadence: a January row is 2 months from March, outside the ±1 tolerance.
    const offCycle = ["2027-03-12", "2027-06-12", "2027-09-12", "2027-12-12"].map((x) =>
      proj("A", x),
    );
    const out = blendAnnouncedDividends(
      offCycle,
      [{ instrumentId: "A", date: "2027-01-20" }],
      quarterly,
    );
    expect(out).toHaveLength(4);
  });

  it("lets two announced rows consume at most one slot each", () => {
    const out = blendAnnouncedDividends(
      Q,
      [
        { instrumentId: "A", date: "2027-01-10" },
        { instrumentId: "A", date: "2027-01-25" },
      ],
      quarterly,
    );
    // Second row finds no unconsumed slot within a month, so only Jan is removed.
    expect(out.map((p) => p.date)).toEqual(["2027-04-12", "2027-07-12", "2027-10-12"]);
  });

  it("matches a monthly payer within 15 days, across a month boundary too", () => {
    const monthly = ["2027-01-10", "2027-02-10", "2027-03-10"].map((x) => proj("M", x));
    const out = blendAnnouncedDividends(
      monthly,
      [{ instrumentId: "M", date: "2027-02-27" }],
      () => 1,
    );
    // Feb 27 is 17 days from Feb 10 and 11 days from Mar 10: it covers the March slot.
    expect(out.map((p) => p.date)).toEqual(["2027-01-10", "2027-02-10"]);
  });

  it("leaves other instruments untouched", () => {
    const other = proj("B", "2027-01-12");
    const out = blendAnnouncedDividends(
      [...Q, other],
      [{ instrumentId: "A", date: "2027-01-12" }],
      quarterly,
    );
    expect(out).toContain(other);
    expect(out).toHaveLength(4);
  });

  it("returns the same objects it was given", () => {
    const out = blendAnnouncedDividends(Q, [], quarterly);
    expect(out).toEqual(Q);
    expect(out[0]).toBe(Q[0]);
  });
});

describe("dividendIntervalMonths", () => {
  const entry = (instrumentId: string, iso: string): IncomeEntry =>
    ({
      instrumentId,
      type: "dividend",
      price: "10",
      currency: "USD",
      executedAt: new Date(`${iso}T00:00:00.000Z`),
    }) as IncomeEntry;
  const now = new Date("2026-11-15T00:00:00.000Z");

  it("infers quarterly, and defaults to annual with too little history", () => {
    const f = dividendIntervalMonths(
      [
        entry("Q", "2026-01-12"),
        entry("Q", "2026-04-12"),
        entry("Q", "2026-07-12"),
        entry("Q", "2026-10-12"),
        entry("Y", "2026-03-01"),
      ],
      now,
    );
    expect(f("Q")).toBe(3);
    expect(f("Y")).toBe(12);
    expect(f("unknown")).toBe(12);
  });

  it("counts a multi-leg month once", () => {
    const f = dividendIntervalMonths(
      [
        entry("Q", "2026-01-12"),
        entry("Q", "2026-01-20"),
        entry("Q", "2026-01-28"),
        entry("Q", "2026-04-12"),
        entry("Q", "2026-07-12"),
      ],
      now,
    );
    expect(f("Q")).toBe(3);
  });
});
