import { describe, it, expect } from "vitest";
import {
  blendAnnouncedDividends,
  dividendIntervalMonths,
  dividendRunRateSamples,
  type IncomeEntry,
} from "../src/index.js";

const proj = (instrumentId: string, date: string, perShare?: string, currency?: string) => ({
  instrumentId,
  date,
  perShare,
  currency,
});
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

describe("blendAnnouncedDividends amount band", () => {
  // Quarterly payer at 1.00/share USD.
  const QA = ["2027-01-12", "2027-04-12", "2027-07-12", "2027-10-12"].map((x) =>
    proj("A", x, "1", "USD"),
  );
  const ann = (date: string, perShare?: string, currency: string | undefined = "USD") => ({
    instrumentId: "A",
    date,
    perShare,
    currency,
  });

  it("keeps the regular payment when the announced row is a special", () => {
    expect(blendAnnouncedDividends(QA, [ann("2027-01-20", "5")], quarterly)).toHaveLength(4);
  });

  it("keeps the regular payment when the announced row is a tiny stub", () => {
    expect(blendAnnouncedDividends(QA, [ann("2027-01-20", "0.1")], quarterly)).toHaveLength(4);
  });

  it("still replaces the slot on a modest raise or cut", () => {
    for (const ps of ["1.2", "0.8", "1.5"]) {
      const out = blendAnnouncedDividends(QA, [ann("2027-01-20", ps)], quarterly);
      expect(out.map((p) => p.date)).toEqual(["2027-04-12", "2027-07-12", "2027-10-12"]);
    }
  });

  it("includes exactly 3x and 1/3x and excludes just outside", () => {
    expect(blendAnnouncedDividends(QA, [ann("2027-01-20", "3")], quarterly)).toHaveLength(3);
    expect(blendAnnouncedDividends(QA, [ann("2027-01-20", "0.33")], quarterly)).toHaveLength(4);
    const p3 = ["2027-01-12"].map((x) => proj("A", x, "3", "USD"));
    expect(blendAnnouncedDividends(p3, [ann("2027-01-20", "1")], quarterly)).toHaveLength(0);
    expect(blendAnnouncedDividends(QA, [ann("2027-01-20", "3.01")], quarterly)).toHaveLength(4);
  });

  it("lets the regular row take the slot and the special consume nothing, in either order", () => {
    for (const [regular, special] of [
      ["2027-01-10", "2027-01-25"],
      ["2027-01-25", "2027-01-10"],
    ]) {
      const out = blendAnnouncedDividends(QA, [ann(regular, "1.1"), ann(special, "6")], quarterly);
      expect(out.map((p) => p.date)).toEqual(["2027-04-12", "2027-07-12", "2027-10-12"]);
    }
  });

  it("treats a replayed special slot as the slot a regular announcement replaces", () => {
    // Last year's 5.00 special is projected into the January slot; the other three are 1.00.
    const withSpecial = [
      proj("A", "2027-01-12", "5", "USD"),
      ...["2027-04-12", "2027-07-12", "2027-10-12"].map((x) => proj("A", x, "1", "USD")),
    ];
    const out = blendAnnouncedDividends(withSpecial, [ann("2027-01-20", "1")], quarterly);
    expect(out.map((p) => p.date)).toEqual(["2027-04-12", "2027-07-12", "2027-10-12"]);
    // A new 5.00 special is still out of band against the 1.00 run-rate.
    expect(blendAnnouncedDividends(withSpecial, [ann("2027-01-20", "5")], quarterly)).toHaveLength(
      4,
    );
  });

  it("uses past payments as the run-rate when every projected slot is special-sized", () => {
    // What the engines emit a year after a special: the trailing-12-month mean is inflated, so
    // every next-year slot carries the same special-sized per-share.
    const uniform = ["2027-01-12", "2027-04-12", "2027-07-12", "2027-10-12"].map((x) =>
      proj("A", x, "2", "USD"),
    );
    const history = ["1", "1", "1", "5"].map((perShare) => ({
      instrumentId: "A",
      currency: "USD",
      perShare,
    }));
    // Against the projections alone a regular 0.5 announcement looks special (0.25x of 2).
    expect(blendAnnouncedDividends(uniform, [ann("2027-01-20", "0.5")], quarterly)).toHaveLength(4);
    // Against the past payments' median (1.00) it is the regular payment and replaces the slot.
    const out = blendAnnouncedDividends(uniform, [ann("2027-01-20", "0.5")], quarterly, history);
    expect(out).toHaveLength(3);
    // A real special is still out of band against that history.
    expect(
      blendAnnouncedDividends(uniform, [ann("2027-01-20", "5")], quarterly, history),
    ).toHaveLength(4);
  });

  it("compares currencies case- and whitespace-insensitively", () => {
    expect(blendAnnouncedDividends(QA, [ann("2027-01-20", "5", " usd ")], quarterly)).toHaveLength(
      4,
    );
  });

  it("falls back to date-only without comparable amounts", () => {
    const cases = [
      ann("2027-01-20", undefined),
      ann("2027-01-20", "50", "EUR"),
      { instrumentId: "A", date: "2027-01-20", perShare: "50" },
    ];
    for (const a of cases) {
      expect(blendAnnouncedDividends(QA, [a], quarterly)).toHaveLength(3);
    }
    const zero = ["2027-01-12"].map((x) => proj("A", x, "0", "USD"));
    expect(blendAnnouncedDividends(zero, [ann("2027-01-20", "50")], quarterly)).toHaveLength(0);
  });
});

describe("dividendRunRateSamples", () => {
  const e = (iso: string, price: string, instrumentId = "Q"): IncomeEntry =>
    ({
      instrumentId,
      type: "dividend",
      price,
      currency: "USD",
      executedAt: new Date(`${iso}T00:00:00.000Z`),
    }) as IncomeEntry;
  const now = new Date("2026-11-15T00:00:00.000Z");

  it("returns per-share amounts for the trailing 24 months, one per month", () => {
    const out = dividendRunRateSamples(
      [
        e("2026-10-12", "5"),
        e("2026-10-20", "5"), // same month as above: bucketed into one 10.00 payment
        e("2026-01-12", "10"),
        e("2024-01-12", "99"), // older than 24 months
      ],
      () => "10",
      now,
    );
    expect(out.map((s) => s.perShare).sort()).toEqual(["1", "1"]);
  });

  it("skips payments with no known quantity", () => {
    expect(dividendRunRateSamples([e("2026-10-12", "5")], () => "0", now)).toEqual([]);
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
