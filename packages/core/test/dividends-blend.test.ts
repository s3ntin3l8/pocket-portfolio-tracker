import { describe, it, expect } from "vitest";
import { blendAnnouncedDividends } from "../src/index.js";

const proj = (instrumentId: string, date: string) => ({ instrumentId, date });
const quarterly = () => 3;
// Quarterly cadence: tolerance is floor(3 / 2) = 1 calendar month.
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

  it("matches a monthly payer within the same month only", () => {
    const monthly = ["2027-01-10", "2027-02-10", "2027-03-10"].map((x) => proj("M", x));
    const out = blendAnnouncedDividends(
      monthly,
      [{ instrumentId: "M", date: "2027-02-25" }],
      () => 1,
    );
    expect(out.map((p) => p.date)).toEqual(["2027-01-10", "2027-03-10"]);
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
