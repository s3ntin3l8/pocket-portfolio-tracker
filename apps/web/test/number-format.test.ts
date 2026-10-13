import { describe, it, expect } from "vitest";
import {
  caretForDigits,
  digitsBefore,
  formatGrouped,
  localeSeparators,
  sanitizeNumericInput,
} from "../src/components/add-transaction-form/number-format";

describe("sanitizeNumericInput", () => {
  it("strips grouping commas back to a raw digit string", () => {
    expect(sanitizeNumericInput("1,234")).toBe("1234");
  });
  it("strips non-numeric characters", () => {
    expect(sanitizeNumericInput("IDR 1,234abc")).toBe("1234");
  });
  it("collapses redundant leading zeros", () => {
    expect(sanitizeNumericInput("007")).toBe("7");
    expect(sanitizeNumericInput("00")).toBe("0");
  });
  it("keeps a lone zero", () => {
    expect(sanitizeNumericInput("0")).toBe("0");
  });
  it("treats a leading dot as 0.x", () => {
    expect(sanitizeNumericInput(".5")).toBe("0.5");
  });
  it("caps the fractional part at 8 digits", () => {
    expect(sanitizeNumericInput("1.123456789")).toBe("1.12345678");
  });
  it("collapses multiple dots into one decimal point", () => {
    expect(sanitizeNumericInput("12.34.56")).toBe("12.3456");
  });
  it("preserves a leading minus sign (adjustment amounts are signed)", () => {
    expect(sanitizeNumericInput("-1,234.5")).toBe("-1234.5");
  });
  it("returns an empty string for blank input", () => {
    expect(sanitizeNumericInput("")).toBe("");
  });
});

describe("formatGrouped", () => {
  it("groups the integer part with thousands separators", () => {
    expect(formatGrouped("1234567")).toBe("1,234,567");
  });
  it("preserves the decimal part ungrouped", () => {
    expect(formatGrouped("1234.5678")).toBe("1,234.5678");
  });
  it("preserves a trailing dot while typing", () => {
    expect(formatGrouped("123.")).toBe("123.");
  });
  it("preserves a leading minus sign", () => {
    expect(formatGrouped("-1234")).toBe("-1,234");
  });
  it("returns an empty string for blank input", () => {
    expect(formatGrouped("")).toBe("");
    expect(formatGrouped(null)).toBe("");
  });
});

describe("locale-aware parsing and formatting", () => {
  it("localeSeparators detects group/decimal per locale", () => {
    expect(localeSeparators("en")).toEqual({ group: ",", decimal: "." });
    expect(localeSeparators("id")).toEqual({ group: ".", decimal: "," });
    expect(localeSeparators("de")).toEqual({ group: ".", decimal: "," });
  });
  it("localeSeparators falls back to the English pair on a malformed tag", () => {
    expect(localeSeparators("not a locale!!")).toEqual({ group: ",", decimal: "." });
  });
  it.each(["id", "de"])("%s: a decimal comma is a decimal point, not dropped", (loc) => {
    expect(sanitizeNumericInput("1,5", loc)).toBe("1.5");
    expect(sanitizeNumericInput("1.234,56", loc)).toBe("1234.56");
    expect(sanitizeNumericInput("1.234", loc)).toBe("1234");
    expect(sanitizeNumericInput("-0,5", loc)).toBe("-0.5");
    expect(sanitizeNumericInput(",5", loc)).toBe("0.5");
  });
  it("en: 1,234.56 stays 1234.56", () => {
    expect(sanitizeNumericInput("1,234.56", "en")).toBe("1234.56");
  });
  it.each([
    ["en", "1,234,567.5"],
    ["id", "1.234.567,5"],
    ["de", "1.234.567,5"],
  ])("%s: formatGrouped renders with the locale and round-trips", (loc, shown) => {
    expect(formatGrouped("1234567.5", loc)).toBe(shown);
    expect(sanitizeNumericInput(shown, loc)).toBe("1234567.5");
  });
  it("id: a trailing decimal comma is preserved while typing", () => {
    expect(formatGrouped("123.", "id")).toBe("123,");
    expect(sanitizeNumericInput("123,", "id")).toBe("123.");
  });
});

describe("caret preservation round-trip", () => {
  it("keeps the caret glued to the same digit after grouping is inserted", () => {
    // "1234" -> caret after "12" (2 digits before) -> becomes "1,234" -> caret after "12" still.
    const digits = digitsBefore("1234", 2);
    expect(digits).toBe(2);
    expect(caretForDigits(formatGrouped("1234"), digits)).toBe(3); // "1," + "2" -> index 3
  });

  it("keeps the caret glued to the same digit after grouping is removed", () => {
    // "1,234" caret after "1,2" (position 3) -> 2 digits before -> raw "1234" -> "1,234" caret at 3.
    const digits = digitsBefore("1,234", 3);
    expect(digits).toBe(2);
    expect(caretForDigits("1,234", digits)).toBe(3);
  });
});
