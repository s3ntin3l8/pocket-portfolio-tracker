import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const ROOT_PX = 16;

// A fractional line box puts text on a half pixel, where the raster rounding is a tie and differs
// between renders (#1220, #1221). Every custom type token, size and line height, is a rem value
// that is a whole number of px at the root size.
describe("type scale", () => {
  // Any `--text-<name>` / `--text-<name>--line-height` whose value is a length or a bare ratio. Colour
  // tokens (`--text-mute: #…`, `--text-2: var(…)`) do not match, so a new size token is checked too.
  const tokens = [
    ...css.matchAll(
      /--text-([a-z0-9]+(?:-[a-z0-9]+)*)(--line-height)?:\s*(\d*\.?\d+(?:rem|px|em)?);/g,
    ),
  ].map(([, name, suffix, value]) => ({ name: name! + (suffix ?? ""), value: value! }));

  it("finds at least the six scale tokens, each size with its line height", () => {
    const names = new Set(tokens.map((t) => t.name));
    for (const n of ["micro", "body-sm", "body", "heading", "display", "hero"]) {
      expect(names).toContain(n);
      expect(names).toContain(`${n}--line-height`);
    }
    for (const n of names) {
      if (!n.endsWith("--line-height")) expect(names).toContain(`${n}--line-height`);
    }
  });

  it.each(tokens.map((t) => [t.name, t.value] as const))(
    "--text-%s is whole pixels (%s)",
    (_name, value) => {
      expect(value).toMatch(/^\d*\.?\d+rem$/);
      expect(Number.isInteger(parseFloat(value) * ROOT_PX)).toBe(true);
    },
  );
});
