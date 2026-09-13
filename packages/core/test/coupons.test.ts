import { describe, it, expect } from "vitest";
import { projectCoupons, normalizeCouponSchedule, type BondPosition } from "../src/index.js";

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
