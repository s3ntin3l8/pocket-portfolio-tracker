import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const ROOT_PX = 16;

// A fractional line box puts text on a half pixel, where the raster rounding is a tie and differs
// between renders (#1220, #1221). Every custom type token, size and line height, is a rem value
// that is a whole number of px at the root size.
describe("type scale", () => {
  const tokens = [
    ...css.matchAll(
      /--text-(micro|body-sm|body|heading|display|hero)(--line-height)?:\s*([^;]+);/g,
    ),
  ].map(([, name, suffix, value]) => ({ name: name! + (suffix ?? ""), value: value!.trim() }));

  it("finds the custom size and line-height tokens", () => {
    expect(tokens.map((t) => t.name).sort()).toEqual(
      ["body", "body-sm", "display", "heading", "hero", "micro"]
        .flatMap((n) => [n, `${n}--line-height`])
        .sort(),
    );
  });

  it.each(tokens.map((t) => [t.name, t.value] as const))(
    "--text-%s is whole pixels (%s)",
    (_name, value) => {
      expect(value).toMatch(/^\d*\.?\d+rem$/);
      expect(Number.isInteger(parseFloat(value) * ROOT_PX)).toBe(true);
    },
  );
});
