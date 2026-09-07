import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { toDecimalSafe } from "../../src/lib/decimal-safe.js";

describe("toDecimalSafe", () => {
  it("returns Decimal(0) for null", () => {
    expect(toDecimalSafe(null).equals(new Decimal(0))).toBe(true);
  });

  it("returns Decimal(0) for undefined", () => {
    expect(toDecimalSafe(undefined).equals(new Decimal(0))).toBe(true);
  });

  it("returns Decimal(0) for empty string", () => {
    expect(toDecimalSafe("").equals(new Decimal(0))).toBe(true);
  });

  it("returns Decimal(0) for non-numeric string", () => {
    expect(toDecimalSafe("abc").equals(new Decimal(0))).toBe(true);
  });

  it("returns Decimal(123) for numeric string", () => {
    expect(toDecimalSafe("123").equals(new Decimal(123))).toBe(true);
  });
});
