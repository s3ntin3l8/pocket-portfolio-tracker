import { describe, expect, it } from "vitest";
import {
  deltaToneOf,
  signToneClass,
  toneBgClass,
  toneClass,
  toneOf,
  trendGlyphOf,
} from "../src/lib/tone";

describe("tone", () => {
  it("treats zero, null and non-finite as flat", () => {
    for (const n of [0, -0, null, undefined, NaN, Infinity]) {
      expect(toneOf(n)).toBe("flat");
      expect(signToneClass(n)).toBe("");
      expect(deltaToneOf(n)).toBe("neutral");
      expect(trendGlyphOf(n)).toBe("");
    }
  });

  it("tones positives up and negatives down", () => {
    expect(toneOf(0.01)).toBe("up");
    expect(toneOf(-0.01)).toBe("down");
    expect(signToneClass(5)).toBe("text-success");
    expect(signToneClass(-5)).toBe("text-destructive");
    expect(deltaToneOf(5)).toBe("up");
    expect(deltaToneOf(-5)).toBe("down");
    expect(trendGlyphOf(5)).toBe("▲");
    expect(trendGlyphOf(-5)).toBe("▼");
  });

  it("maps tones to text and background classes", () => {
    expect(toneClass("up")).toBe("text-success");
    expect(toneClass("down")).toBe("text-destructive");
    expect(toneClass("flat")).toBe("");
    expect(toneClass("neutral")).toBe("");
    expect(toneBgClass("up")).toBe("bg-success");
    expect(toneBgClass("down")).toBe("bg-destructive");
    expect(toneBgClass("flat")).toBe("bg-muted-foreground");
  });
});

import { pnlToneClass } from "../src/components/trades-table/constants";

describe("pnlToneClass", () => {
  it("keeps zero muted instead of green or red", () => {
    expect(pnlToneClass(0)).toBe("text-muted-foreground");
    expect(pnlToneClass(12)).toBe("text-success");
    expect(pnlToneClass(-12)).toBe("text-destructive");
  });
});
