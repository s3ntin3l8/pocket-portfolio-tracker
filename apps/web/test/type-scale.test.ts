import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const ROOT_PX = 16;

// A fractional line box puts text on a half pixel, where the raster rounding is a tie and differs
// between renders (#1220, #1221). Every custom type token, size and line height, is a rem value
// that is a whole number of px at the root size.
const tokens = [
  ...css.matchAll(
    /--text-([a-z0-9]+(?:-[a-z0-9]+)*)(--line-height)?:\s*(\d*\.?\d+(?:rem|px|em)?);/g,
  ),
].map(([, name, suffix, value]) => ({ name: name! + (suffix ?? ""), value: value! }));

describe("type scale", () => {
  // Any `--text-<name>` / `--text-<name>--line-height` whose value is a length or a bare ratio. Colour
  // tokens (`--text-mute: #…`, `--text-2: var(…)`) do not match, so a new size token is checked too.
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
// The `text-*` size and the `leading-*` are resolved together, within one class string or, failing that,
// across the whole `className` expression (`cn("text-xs", cond && "leading-relaxed")`).
const STOCK_SIZE_PX: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
};
// The custom steps come from the CSS parsed above, so a changed `--text-micro` cannot desync the sweep.
const SIZE_PX: Record<string, number> = {
  ...STOCK_SIZE_PX,
  ...Object.fromEntries(
    tokens
      .filter((t) => !t.name.endsWith("--line-height"))
      .map((t) => [t.name, parseFloat(t.value) * ROOT_PX]),
  ),
};
const SIZE_RE = new RegExp(
  `(?<![\\w-])text-(${Object.keys(SIZE_PX)
    .sort((a, b) => b.length - a.length)
    .join("|")})(?![\\w-])`,
);
const LEADING_RE = /(?<![\w-])leading-(none|tight|snug|normal|relaxed|loose|\[[^\]]+\])(?![\w-])/;
const RATIO: Record<string, number> = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
};

/** Why `classes` has a fractional line box, or `null` when it is whole or not decidable. */
export function fractionalLeading(classes: string, context = ""): string | null {
  const leading = LEADING_RE.exec(classes)?.[1];
  if (!leading) return null;
  const arbitrary = leading.startsWith("[") ? leading.slice(1, -1) : null;
  if (arbitrary?.endsWith("px"))
    return Number.isInteger(parseFloat(arbitrary)) ? null : `leading-${leading} is fractional`;
  if (arbitrary?.endsWith("rem"))
    return Number.isInteger(parseFloat(arbitrary) * ROOT_PX)
      ? null
      : `leading-${leading} is fractional`;
  if (arbitrary !== null && !/^\d*\.?\d+$/.test(arbitrary))
    return `leading-${leading} uses a unit the sweep cannot resolve (use px, rem or a unitless ratio)`;
  // `leading-none` is the font size itself, whole whenever the size is.
  const size = SIZE_RE.exec(classes)?.[1] ?? SIZE_RE.exec(context)?.[1];
  if (!size && leading === "none") return null;
  if (!size)
    return /text-\[/.test(`${classes} ${context}`)
      ? null
      : `leading-${leading} has no text size in the same className to resolve against (put the size next to it, or use a whole-pixel step such as leading-4/5/6)`;
  const ratio = arbitrary === null ? RATIO[leading]! : Number(arbitrary);
  const px = Math.round(SIZE_PX[size]! * ratio * 1e6) / 1e6;
  return Number.isInteger(px) ? null : `text-${size} leading-${leading} is ${px}px`;
}

const LITERAL_RE = /["'`]([^"'`\n]*)["'`]/g;

/** The end of the JSX attribute value or `cn(…)` argument list starting at `start`, by bracket depth. */
function expressionEnd(source: string, start: number): number {
  const open = source[start];
  if (open === '"' || open === "'") return source.indexOf(open, start + 1) + 1;
  if (open !== "{") return start;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return i + 1;
  }
  return source.length;
}

/** Every fractional line box in a source file, each literal resolved against its `className` expression. */
export function sweep(source: string): string[] {
  const found: string[] = [];
  const spans: [number, number][] = [];
  for (const m of source.matchAll(/\b\w*[cC]lassName\s*=\s*/g)) {
    const start = m.index! + m[0].length;
    spans.push([start, expressionEnd(source, start)]);
  }
  const check = (literal: string, context: string) => {
    const why = fractionalLeading(literal, context);
    if (why) found.push(why);
  };
  for (const [from, to] of spans) {
    const expression = source.slice(from, to);
    const literals = [...expression.matchAll(LITERAL_RE)].map((l) => l[1]!);
    const context = literals.join(" ");
    for (const literal of literals) check(literal, context);
  }
  for (const m of source.matchAll(LITERAL_RE)) {
    const at = m.index!;
    if (!spans.some(([from, to]) => at >= from && at < to)) check(m[1]!, "");
  }
  return found;
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
    expect(fractionalLeading("text-xs leading-[1.5em]")).toMatch("unit the sweep cannot resolve");
  });

  it("takes the size from the custom tokens parsed out of the CSS", () => {
    expect(SIZE_PX.micro).toBe(11);
    expect(SIZE_PX["body-sm"]).toBe(13);
    expect(fractionalLeading("text-body-sm leading-tight")).toMatch("16.25px");
  });

  it("resolves the size across the whole className expression", () => {
    expect(sweep('<p className={cn("text-xs", on && "leading-relaxed")} />')).toEqual([
      "text-xs leading-relaxed is 19.5px",
    ]);
    expect(sweep('<p className={cn("text-hero", on && "leading-tight")} />')).toEqual([]);
    expect(sweep('<p className="text-sm leading-5" />')).toEqual([]);
    expect(sweep('<p className={cn("font-bold", on && "leading-tight")} />')).toEqual([
      expect.stringMatching(/no text size in the same className/),
    ]);
    expect(sweep('const row = "text-xs leading-relaxed";')).toEqual([
      "text-xs leading-relaxed is 19.5px",
    ]);
  });

  it("finds no fractional line box under apps/web/src", () => {
    const root = path.resolve(__dirname, "../src");
    const found: string[] = [];
    for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(rel)) continue;
      for (const why of sweep(readFileSync(path.join(root, rel), "utf8")))
        found.push(`${rel}: ${why}`);
    }
    expect(found).toEqual([]);
  });
});
