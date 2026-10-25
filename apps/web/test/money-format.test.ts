import { describe, expect, it } from "vitest";
import { formatMoney } from "../src/components/add-transaction-form/totals";

/**
 * The Add-transaction sheet shows the amount the user typed (locale-grouped by
 * `number-format.ts`) right next to the live total. The total used to be formatted with a
 * hard-coded "en-US", so in the Indonesian locale the input read "1.234,56" while the
 * total next to it read "$1,234.56" — two conventions in one sheet.
 */
describe("add-transaction totals money formatting", () => {
  it("groups the digits the way the app locale does", () => {
    expect(formatMoney(1234.56, "USD", "en")).toBe("$1,234.56");
    expect(formatMoney(1234.56, "USD", "id")).toBe("US$1.234,56");
  });

  it("renders the same amount differently per locale", () => {
    expect(formatMoney(1234.56, "USD", "en")).not.toBe(formatMoney(1234.56, "USD", "id"));
  });

  it("keeps IDR without decimals", () => {
    // Intl separates a currency code/symbol from the digits with a non-breaking space.
    expect(formatMoney(1234, "IDR", "en")).toBe("IDR\u00a01,234");
    expect(formatMoney(1234, "IDR", "id")).toBe("Rp\u00a01.234");
  });

  it("returns an empty string for non-finite input", () => {
    expect(formatMoney(NaN, "USD", "en")).toBe("");
  });
});
