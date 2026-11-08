import { readdirSync, readFileSync } from "node:fs";
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

// A component `leading-*` beats the token's line height, so it has to land on whole pixels too (#1224).
// Checked per class-string literal: the `text-*` size and the `leading-*` next to it are resolved
// together. Tailwind's own steps are included because components mix them with the custom ones.
const SIZE_PX: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  micro: 11,
  "body-sm": 13,
  body: 15,
  heading: 22,
  display: 28,
  hero: 36,
};
const RATIO: Record<string, number> = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
};

/** The reason a class string has a fractional line box, or `null` when it is fine or not decidable. */
export function fractionalLeading(classes: string): string | null {
  const leading =
    /(?<![\w-])leading-(none|tight|snug|normal|relaxed|loose|\[[^\]]+\])(?![\w-])/.exec(
      classes,
    )?.[1];
  if (!leading) return null;
  const size =
    /(?<![\w-])text-(2xl|3xl|4xl|5xl|xs|sm|base|lg|xl|micro|body-sm|body|heading|display|hero)(?![\w-])/.exec(
      classes,
    )?.[1];
  const arbitrary = leading.startsWith("[") ? leading.slice(1, -1) : null;
  if (arbitrary?.endsWith("px"))
    return Number.isInteger(parseFloat(arbitrary)) ? null : `${leading} is fractional`;
  if (arbitrary?.endsWith("rem"))
    return Number.isInteger(parseFloat(arbitrary) * ROOT_PX) ? null : `${leading} is fractional`;
  const ratio = arbitrary === null ? RATIO[leading]! : Number(arbitrary);
  // `leading-none` is the font size itself, whole whenever the size is.
  if (!size && leading === "none") return null;
  if (!size)
    return /text-\[/.test(classes)
      ? null
      : `leading-${leading} has no text size next to it to resolve against`;
  const px = Math.round(SIZE_PX[size]! * ratio * 1e6) / 1e6;
  return Number.isInteger(px) ? null : `text-${size} leading-${leading} is ${px}px`;
}

describe("component line heights", () => {
  it("flags a fractional line box and passes whole ones", () => {
    expect(fractionalLeading("text-xs leading-relaxed")).toMatch("19.5px");
    expect(fractionalLeading("text-micro leading-tight")).toMatch("13.75px");
    expect(fractionalLeading("text-xs leading-[1.45]")).toMatch("17.4px");
    expect(fractionalLeading("text-sm leading-snug")).toMatch("19.25px");
    expect(fractionalLeading("leading-tight")).toMatch("no text size");
    expect(fractionalLeading("text-hero font-bold leading-tight")).toBeNull();
    expect(fractionalLeading("text-xs leading-[1.5]")).toBeNull();
    expect(fractionalLeading("text-sm leading-5")).toBeNull();
    expect(fractionalLeading("text-[clamp(2rem,3vw,3rem)] leading-[1.1]")).toBeNull();
    expect(fractionalLeading("text-xs leading-[17.5px]")).toMatch("fractional");
  });

  it("finds no fractional line box under apps/web/src", () => {
    const root = path.resolve(__dirname, "../src");
    const found: string[] = [];
    for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(rel)) continue;
      const source = readFileSync(path.join(root, rel), "utf8");
      for (const [, literal] of source.matchAll(/["'`]([^"'`\n]*\bleading-[^"'`\n]*)["'`]/g)) {
        const why = fractionalLeading(literal!);
        if (why) found.push(`${rel}: ${why}`);
      }
    }
    expect(found).toEqual([]);
  });
});
