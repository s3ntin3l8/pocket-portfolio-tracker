import { describe, it, expect } from "vitest";
import { DEFAULT_HERO_RANGE, resolveHeroRange } from "../src/lib/chart-range";

describe("resolveHeroRange", () => {
  it("uses the default when there is no param", () => {
    expect(resolveHeroRange(undefined)).toBe(DEFAULT_HERO_RANGE);
    expect(resolveHeroRange(null)).toBe("1y");
  });

  it("accepts the hero ranges", () => {
    for (const r of ["1d", "7d", "1m", "1y", "all"]) expect(resolveHeroRange(r, true)).toBe(r);
  });

  it("rejects unknown and non-hero ranges", () => {
    expect(resolveHeroRange("5y")).toBe("1y");
    expect(resolveHeroRange("3m")).toBe("1y");
    expect(resolveHeroRange("ytd")).toBe("1y");
  });

  it("falls back to the default for an intraday deep link when no intraday data exists", () => {
    expect(resolveHeroRange("1d", false)).toBe("1y");
    expect(resolveHeroRange("7d", false)).toBe("1y");
    // Day-grained ranges are unaffected.
    expect(resolveHeroRange("1m", false)).toBe("1m");
  });

  it("keeps an intraday range when the intraday check merely failed", () => {
    expect(resolveHeroRange("1d", "unavailable")).toBe("1d");
    expect(resolveHeroRange("7d", true)).toBe("7d");
  });
});
