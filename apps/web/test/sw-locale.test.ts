import { describe, it, expect } from "vitest";
import { resolveLocalePrefix } from "../src/app/sw-locale";

describe("resolveLocalePrefix", () => {
  it("returns the locale prefix for a known locale", () => {
    expect(resolveLocalePrefix("NEXT_LOCALE=id")).toBe("/id");
    expect(resolveLocalePrefix("foo=bar; NEXT_LOCALE=en; baz=qux")).toBe("/en");
  });

  it("returns empty when the cookie is absent", () => {
    expect(resolveLocalePrefix("")).toBe("");
    expect(resolveLocalePrefix("foo=bar")).toBe("");
  });

  it("rejects a value outside the known locale set (open-redirect guard)", () => {
    expect(resolveLocalePrefix("NEXT_LOCALE=%2Fevil.com")).toBe("");
    expect(resolveLocalePrefix("NEXT_LOCALE=evil.com")).toBe("");
    expect(resolveLocalePrefix("NEXT_LOCALE=de")).toBe("");
  });

  it("does not throw on malformed percent-encoding", () => {
    expect(resolveLocalePrefix("NEXT_LOCALE=%")).toBe("");
  });
});
