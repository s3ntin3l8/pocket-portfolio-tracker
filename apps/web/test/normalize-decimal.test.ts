import { describe, it, expect } from "vitest";
import { normalizeDecimal } from "../src/components/record-corporate-action/normalize-decimal";

describe("normalizeDecimal", () => {
  it("converts German-formatted numbers", () => {
    expect(normalizeDecimal("3.869,77")).toBe("3869.77");
    expect(normalizeDecimal("0,5")).toBe("0.5");
  });
  it("passes plain decimals through and trims", () => {
    expect(normalizeDecimal(" 12.5 ")).toBe("12.5");
    expect(normalizeDecimal("100")).toBe("100");
  });
});
