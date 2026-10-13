import { describe, it, expect } from "vitest";
import { fractionToPercent, percentToFraction } from "@/lib/tax-rate";

describe("tax-rate percent <-> fraction", () => {
  it("shifts digits without float noise", () => {
    expect(fractionToPercent("0.30")).toBe("30");
    expect(fractionToPercent("0.125")).toBe("12.5");
    expect(fractionToPercent("0.07")).toBe("7");
    expect(fractionToPercent(null)).toBe("");
    expect(percentToFraction("30")).toBe("0.3");
    expect(percentToFraction("12.5")).toBe("0.125");
    expect(percentToFraction("7.1")).toBe("0.071");
    expect(percentToFraction("0")).toBe("0");
    expect(percentToFraction("100")).toBe("1");
  });

  it("rejects non-numbers and out-of-range values", () => {
    expect(percentToFraction("abc")).toBeNull();
    expect(percentToFraction("-5")).toBeNull();
    expect(percentToFraction("100.1")).toBeNull();
    expect(percentToFraction("")).toBeNull();
  });
});
