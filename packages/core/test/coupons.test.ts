import { describe, it, expect } from "vitest";
import { projectCoupons, type BondPosition } from "../src/index.js";

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
