import { describe, it, expect } from "vitest";
import {
  projectCoupons,
  couponRateForDate,
  normalizeCouponSchedule,
  type BondPosition,
  type BondCouponRateSchedule,
} from "../src/index.js";

const d = (iso: string) => new Date(iso);

const NOW = new Date("2026-09-07T12:00:00.000Z"); // mid-day UTC, deliberately not at 00:00
const TODAY_KEY = "2026-09-07";

function bond(overrides: Partial<BondPosition> = {}): BondPosition {
  return {
    instrumentId: "bond-1",
    symbol: "BOND",
    name: "Bond",
    quantity: "1",
    faceValue: "1000",
    couponRate: "0.06",
    couponSchedule: "annual",
    maturityDate: "2027-09-07",
    currency: "EUR",
    ...overrides,
  };
}

describe("projectCoupons — today's UTC date inclusion (S5 boundary)", () => {
  it("includes a coupon landing on today's UTC date", () => {
    // Maturity: 2027-09-07 (= today + 12mo). Annual schedule, so walking back from
    // maturity lands on TODAY (2026-09-07), and then 2025-09-07, etc.
    // Old code used `d > now` where `now` is the precise instant (12:00); d == today
    // at 00:00 was < now, so the loop bailed BEFORE pushing today's coupon.
    const rows = projectCoupons([bond()], 24, NOW);
    const today = rows.find((c) => c.date === TODAY_KEY);
    expect(today).toBeDefined();
    expect(today?.instrumentId).toBe("bond-1");
    expect(today?.symbol).toBe("BOND");
    expect(today?.currency).toBe("EUR");
    // amount = faceValue × quantity × couponRate / periodsPerYear = 1000 × 1 × 0.06 / 1 = 60
    expect(today?.amount).toBe("60");
  });

  it("still excludes coupons landing before today's UTC date", () => {
    // Maturity 2027-09-07, annual → coupons at 2026-09-07 (today), 2025-09-07 (yesterday),
    // etc. The 2025-09-07 row MUST NOT be returned (we have no negative-time lookup).
    const rows = projectCoupons([bond()], 24, NOW);
    expect(rows.some((r) => r.date === "2025-09-07")).toBe(false);
  });

  it("still includes coupons strictly after today's UTC date", () => {
    // Maturity 2027-09-07 with no further rows strictly after today? Use a larger
    // maturity so 2027-09-07 itself is in the result. Stricter than today: 2027 itself.
    const rows = projectCoupons([bond({ maturityDate: "2028-09-07" })], 36, NOW);
    const futures = rows.filter((r) => r.date > TODAY_KEY);
    expect(futures.some((r) => r.date === "2027-09-07")).toBe(true);
    expect(futures.some((r) => r.date === "2028-09-07")).toBe(true);
  });

  it("horizon upper bound still respected when today is the first included coupon", () => {
    // horizon = 2027-01-01: today's coupon (2026-09-07) is in range; the 2027-09-07
    // maturity coupon is OUT of range and must be excluded by the inner `d <= horizonEnd`
    // check.
    const rows = projectCoupons([bond({ maturityDate: "2027-09-07" })], d("2027-01-01"), NOW);
    expect(rows.some((r) => r.date === TODAY_KEY)).toBe(true);
    expect(rows.some((r) => r.date === "2027-09-07")).toBe(false);
  });
});

describe("normalizeCouponSchedule", () => {
  it("passes through exact keys unchanged", () => {
    expect(normalizeCouponSchedule("monthly")).toBe("monthly");
    expect(normalizeCouponSchedule("quarterly")).toBe("quarterly");
    expect(normalizeCouponSchedule("semiannual")).toBe("semiannual");
    expect(normalizeCouponSchedule("annual")).toBe("annual");
  });

  it("normalizes the historical 'semi-annual' seed value to 'semiannual'", () => {
    expect(normalizeCouponSchedule("semi-annual")).toBe("semiannual");
  });

  it("normalizes separator and casing variants", () => {
    expect(normalizeCouponSchedule("semi_annual")).toBe("semiannual");
    expect(normalizeCouponSchedule("SEMIANNUAL")).toBe("semiannual");
    expect(normalizeCouponSchedule("Monthly")).toBe("monthly");
    expect(normalizeCouponSchedule("bi-annual")).toBe("semiannual");
  });

  it("falls back to semiannual for null, empty, or unknown input", () => {
    expect(normalizeCouponSchedule(null)).toBe("semiannual");
    expect(normalizeCouponSchedule(undefined)).toBe("semiannual");
    expect(normalizeCouponSchedule("")).toBe("semiannual");
    expect(normalizeCouponSchedule("garbage")).toBe("semiannual");
  });
});

describe("projectCoupons — monthly schedule (Indonesian retail SR/ORI convention)", () => {
  it("projects 12 coupons/year at faceValue × quantity × couponRate / 12", () => {
    // SR021T3-shaped position: Rp 1,000,000 nominal, 10 units, 6.35% p.a., monthly.
    const srBond: BondPosition = {
      instrumentId: "sr021t3",
      symbol: "SR021T3",
      name: "Sukuk Negara Ritel seri SR021T3",
      quantity: "10",
      faceValue: "1000000",
      couponRate: "0.0635",
      couponSchedule: "monthly",
      maturityDate: "2027-09-10",
      currency: "IDR",
    };
    const rows = projectCoupons([srBond], 12, new Date("2026-09-13T00:00:00.000Z"));
    expect(rows).toHaveLength(12);
    // 1,000,000 × 10 × 0.0635 / 12 = 52916.666...
    for (const r of rows) {
      expect(Number(r.amount)).toBeCloseTo(52916.6666667, 4);
    }
  });

  it("normalizes a mis-cased/hyphenated monthly schedule the same way", () => {
    const srBond: BondPosition = {
      instrumentId: "sr021t3",
      symbol: "SR021T3",
      name: "Sukuk Negara Ritel seri SR021T3",
      quantity: "10",
      faceValue: "1000000",
      couponRate: "0.0635",
      couponSchedule: "Monthly",
      maturityDate: "2027-09-10",
      currency: "IDR",
    };
    const rows = projectCoupons([srBond], 12, new Date("2026-09-13T00:00:00.000Z"));
    expect(rows).toHaveLength(12);
  });
});

describe("projectCoupons — floating-rate bonds (SBR/ST rate schedule)", () => {
  // An SBR015T2-shaped position: Rp 1,000,000 nominal, MONTHLY payments, QUARTERLY rate
  // resets, and no flat couponRate — the rate comes from the schedule.
  const SBR_SCHEDULE: BondCouponRateSchedule = {
    floorRate: "0.0675",
    periods: [
      { from: "2026-01-10", to: "2026-04-10", rate: "0.0675" },
      { from: "2026-04-10", to: "2026-07-10", rate: "0.07" },
      { from: "2026-07-10", rate: "0.0725" },
    ],
  };

  function sbr(overrides: Partial<BondPosition> = {}): BondPosition {
    return {
      instrumentId: "sbr015t2",
      symbol: "SBR015T2",
      name: "SBR015T2",
      quantity: "1",
      faceValue: "1000000",
      couponRate: "",
      couponSchedule: "monthly",
      couponRateSchedule: SBR_SCHEDULE,
      maturityDate: "2028-07-10",
      currency: "IDR",
      ...overrides,
    };
  }

  // Mid-period, so the ladder (which walks back from maturity) starts on 2026-03-10.
  const NOW = new Date("2026-02-15T00:00:00.000Z");

  const amountOn = (rows: { date: string; amount: string }[], date: string) =>
    rows.find((r) => r.date === date)?.amount;

  it("prices each coupon at the rate of the period it falls in", () => {
    const rows = projectCoupons([sbr()], 12, NOW);
    expect(rows).toHaveLength(12);
    // 1,000,000 × 0.0675 / 12 = 5625 exactly
    expect(amountOn(rows, "2026-03-10")).toBe("5625");
    // 1,000,000 × 0.07 / 12 = 5833.3333333333333333
    expect(amountOn(rows, "2026-04-10")).toBe("5833.3333333333333333");
    // 1,000,000 × 0.0725 / 12 = 6041.6666666666666667
    expect(amountOn(rows, "2026-07-10")).toBe("6041.6666666666666667");
    // The open-ended period still covers the rest of the horizon.
    expect(amountOn(rows, "2026-12-10")).toBe("6041.6666666666666667");
  });

  it("falls back to the floor rate for a date no announced period covers", () => {
    const schedule: BondCouponRateSchedule = {
      floorRate: "0.0675",
      periods: [{ from: "2026-01-10", to: "2026-04-10", rate: "0.07" }],
    };
    const rows = projectCoupons([sbr({ couponRateSchedule: schedule })], 12, NOW);
    // Inside the announced period → the announced rate.
    expect(amountOn(rows, "2026-03-10")).toBe("5833.3333333333333333");
    // Outside it → the contractual floor, never zero.
    expect(amountOn(rows, "2026-05-10")).toBe("5625");
  });

  it("treats a period's start as inclusive and its end as exclusive", () => {
    const schedule: BondCouponRateSchedule = {
      floorRate: "0.0675",
      periods: [
        { from: "2026-01-10", to: "2026-04-10", rate: "0.07" },
        { from: "2026-04-10", rate: "0.0725" },
      ],
    };
    const rows = projectCoupons([sbr({ couponRateSchedule: schedule })], 12, NOW);
    // 2026-04-10 is the END of the first period and the START of the second — it must
    // take the second period's rate.
    expect(amountOn(rows, "2026-04-10")).toBe("6041.6666666666666667");
    expect(amountOn(rows, "2026-03-10")).toBe("5833.3333333333333333");
  });

  it("covers a date with an open-ended period (no end date)", () => {
    const schedule: BondCouponRateSchedule = {
      floorRate: "0.0675",
      periods: [{ from: "2026-01-10", rate: "0.0725" }],
    };
    const rows = projectCoupons([sbr({ couponRateSchedule: schedule })], 12, NOW);
    expect(amountOn(rows, "2026-03-10")).toBe("6041.6666666666666667");
    expect(amountOn(rows, "2027-01-10")).toBe("6041.6666666666666667");
  });

  it("lets the schedule win over a flat couponRate on the same instrument", () => {
    // A bond that was first entered as fixed-rate (6.00 %) and later identified as
    // floating: the schedule is authoritative for the dates it covers.
    const rows = projectCoupons([sbr({ couponRate: "0.06" })], 12, NOW);
    expect(amountOn(rows, "2026-03-10")).toBe("5625");
    expect(amountOn(rows, "2026-04-10")).toBe("5833.3333333333333333");
  });

  it("emits no coupons at all when the position has neither a rate nor a schedule", () => {
    const rows = projectCoupons([sbr({ couponRate: "", couponRateSchedule: null })], 12, NOW);
    expect(rows).toEqual([]);
  });

  it("keeps the flat-rate path byte-identical (regression guard)", () => {
    // No schedule → the amount is exactly what it has always been:
    // faceValue × quantity × couponRate / periods.
    const rows = projectCoupons([bond()], 24, NOW);
    expect(amountOn(rows, TODAY_KEY)).toBe("60");
    const monthly = projectCoupons(
      [
        bond({
          faceValue: "1000000",
          couponRate: "0.0635",
          couponSchedule: "monthly",
          maturityDate: "2027-09-10",
        }),
      ],
      12,
      new Date("2026-09-13T00:00:00.000Z"),
    );
    expect(amountOn(monthly, "2026-10-10")).toBe("5291.6666666666666667");
  });

  it("computes coupon amounts in decimal, never through a float", () => {
    const schedule: BondCouponRateSchedule = {
      floorRate: "0.0685",
      periods: [{ from: "2026-01-10", rate: "0.0685" }],
    };
    const rows = projectCoupons([sbr({ couponRateSchedule: schedule })], 12, NOW);
    // 1,000,000 × 0.0685 / 12 = 5708.3333333333333333 (20 significant digits — the
    // float equivalent would be 5708.333333333333).
    expect(amountOn(rows, "2026-03-10")).toBe("5708.3333333333333333");
  });
});

describe("couponRateForDate", () => {
  const position: BondPosition = {
    instrumentId: "sbr015t2",
    symbol: "SBR015T2",
    quantity: "1",
    faceValue: "1000000",
    couponRate: "0.06",
    couponSchedule: "monthly",
    couponRateSchedule: {
      floorRate: "0.0675",
      periods: [
        { from: "2026-01-10", to: "2026-04-10", rate: "0.0675" },
        { from: "2026-04-10", rate: "0.07" },
      ],
    },
    maturityDate: "2028-07-10",
    currency: "IDR",
  };

  it("returns the announced rate of the period containing the date", () => {
    expect(couponRateForDate(position, "2026-02-01")).toBe("0.0675");
    expect(couponRateForDate(position, "2026-04-10")).toBe("0.07");
  });

  it("falls back to the floor outside the announced periods", () => {
    expect(couponRateForDate(position, "2025-12-31")).toBe("0.0675");
  });

  it("returns the flat rate when the position has no schedule", () => {
    const fixed = { ...position, couponRateSchedule: null };
    expect(couponRateForDate(fixed, "2026-02-01")).toBe("0.06");
  });

  it("returns null when the position has neither a rate nor a schedule", () => {
    expect(
      couponRateForDate({ ...position, couponRate: "", couponRateSchedule: null }, "2026-02-01"),
    ).toBeNull();
  });
});
