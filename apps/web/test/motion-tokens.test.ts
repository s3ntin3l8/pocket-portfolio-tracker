import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const uiDir = path.resolve(__dirname, "../src/components/ui");

// Tailwind ships these; anything else must be a `--animate-*` token in globals.css. The
// tooltip once used `animate-in fade-in-0 zoom-in-95` (tw-animate-css classes, not installed),
// which silently produced no animation at all.
const BUILTIN = new Set(["spin", "ping", "pulse", "bounce", "none"]);

describe("ui primitive animation classes", () => {
  const used = new Map<string, string[]>();
  for (const file of readdirSync(uiDir).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(path.join(uiDir, file), "utf8");
    for (const [, name] of src.matchAll(/(?<![\w-])animate-([a-z][a-z0-9-]*)/g)) {
      used.set(name!, [...(used.get(name!) ?? []), file]);
    }
  }

  it("finds the overlay animation classes", () => {
    expect([...used.keys()]).toEqual(expect.arrayContaining(["pop-in", "pop-out", "overlay-in"]));
  });

  it.each([...used.entries()].filter(([name]) => !BUILTIN.has(name)))(
    "animate-%s resolves to a --animate token",
    (name, files) => {
      expect(css, `used in ${files.join(", ")}`).toMatch(new RegExp(`--animate-${name}:`));
    },
  );
});

describe("reduced motion", () => {
  // The override only reaches a utility whose token lives in a plain `@theme` block: in
  // `@theme inline` the value is baked into the utility and a `:root` override is a no-op.
  it("zeroes every overlay token inside a prefers-reduced-motion block", () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)];
    const reduced = blocks.map((m) => m[1]).join("\n");
    for (const t of ["overlay-in", "overlay-out", "pop-in", "pop-out", "page-in", "page-out"]) {
      expect(reduced).toMatch(new RegExp(`--animate-${t}:\\s*none`));
    }
  });
});
