import { describe, it, expect } from "vitest";
import { fxPartial, noDisplayFigures } from "../src/lib/fx-missing";

describe("noDisplayFigures / fxPartial (#1181)", () => {
  it("a flagged row with no display value is wholly excluded, not partial", () => {
    const h = { fxMissing: true, marketValueDisplay: null };
    expect(noDisplayFigures(h)).toBe(true);
    expect(fxPartial(h)).toBe(false);
  });

  it("a flagged row that still has a display value is partial, not excluded", () => {
    const h = { fxMissing: true, marketValueDisplay: "1000" };
    expect(noDisplayFigures(h)).toBe(false);
    expect(fxPartial(h)).toBe(true);
  });

  it("fxMissing alone decides, whatever valuedAtCost says (the seam #1193 may move)", () => {
    const h = { fxMissing: true, valuedAtCost: true, marketValueDisplay: "1000" };
    expect(fxPartial(h)).toBe(true);
    expect(noDisplayFigures(h)).toBe(false);
    const atCostOnly = { valuedAtCost: true, marketValueDisplay: "1000" };
    expect(fxPartial(atCostOnly)).toBe(false);
    expect(noDisplayFigures(atCostOnly)).toBe(false);
  });

  it("an unflagged row is neither, whatever its value", () => {
    for (const marketValueDisplay of [null, "1000"]) {
      const h = { marketValueDisplay };
      expect(noDisplayFigures(h)).toBe(false);
      expect(fxPartial(h)).toBe(false);
    }
  });
});
