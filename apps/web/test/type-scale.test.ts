import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const ROOT_PX = 16;

// A fractional line box puts text on a half pixel, where the raster rounding is a tie and differs
// between renders (#1220, #1221). Every type token must resolve to whole pixels at the root size.
describe("type scale", () => {
  const sizes = new Map<string, number>();
  const heights = new Map<string, string>();
  for (const [, name, suffix, value] of css.matchAll(
    /--text-([a-z-]+?)(--line-height)?:\s*([^;]+);/g,
  )) {
    if (suffix) heights.set(name!, value!.trim());
    else if (value!.trim().endsWith("rem")) sizes.set(name!, parseFloat(value!) * ROOT_PX);
  }

  it("finds the custom tokens", () => {
    expect([...heights.keys()].sort()).toEqual([
      "body",
      "body-sm",
      "display",
      "heading",
      "hero",
      "micro",
    ]);
  });

  it.each([...heights])("--text-%s line height is a whole number of px", (name, value) => {
    const px = value.endsWith("rem")
      ? parseFloat(value) * ROOT_PX
      : parseFloat(value) * sizes.get(name)!;
    expect(Number.isInteger(px)).toBe(true);
    expect(value.endsWith("rem")).toBe(true);
  });
});
