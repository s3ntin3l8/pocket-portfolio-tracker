import { describe, expect, it } from "vitest";
import { mixAlpha, tint, tintStyle } from "@/lib/tint";

describe("tint", () => {
  it("returns a translucent bg and a solid fg that follow the theme tokens", () => {
    expect(tint("primary")).toEqual({
      bg: "color-mix(in srgb, var(--primary) 14%, transparent)",
      fg: "var(--primary)",
    });
  });

  it("accepts a custom opacity", () => {
    expect(tint("destructive", 12).bg).toBe(
      "color-mix(in srgb, var(--destructive) 12%, transparent)",
    );
  });

  it("uses per-tone default opacity", () => {
    expect(tint("gold").bg).toContain(" 16%");
    expect(tint("destructive").bg).toContain(" 13%");
  });

  it("maps every tone to a CSS variable, never a literal colour", () => {
    for (const tone of [
      "primary",
      "destructive",
      "gold",
      "warning",
      "violet",
      "teal",
      "info",
      "orange",
      "slate",
    ] as const) {
      expect(tint(tone).fg).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it("mixAlpha wraps any CSS colour", () => {
    expect(mixAlpha("var(--primary-foreground)", 55)).toBe(
      "color-mix(in srgb, var(--primary-foreground) 55%, transparent)",
    );
  });

  it("tintStyle maps to inline-style keys", () => {
    expect(tintStyle("teal", 16)).toEqual({
      background: "color-mix(in srgb, var(--chart-3) 16%, transparent)",
      color: "var(--chart-3)",
    });
  });
});
