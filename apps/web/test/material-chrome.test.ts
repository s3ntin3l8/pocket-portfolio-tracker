import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(__dirname, "../src");
const css = readFileSync(path.join(src, "app/globals.css"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Decorative glass on the marketing page / onboarding art is not chrome that carries content.
const EXEMPT = ["components/landing.tsx", "components/onboarding/steps/field.tsx"];

describe("translucent chrome", () => {
  it("goes solid under prefers-reduced-transparency and prefers-contrast", () => {
    for (const feature of ["prefers-reduced-transparency", "prefers-contrast: more"]) {
      const block = css.match(
        new RegExp(`@media\\s*\\(\\s*${feature}[^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`),
      );
      expect(block, feature).not.toBeNull();
      const chrome = block![1].match(/\.material-chrome\s*\{([^}]*)\}/)?.[1] ?? "";
      expect(chrome).toMatch(/(?<!-)backdrop-filter:\s*none/);
      // The surface itself must go solid, not just lose its blur.
      expect(chrome).toMatch(/background-color:\s*var\(--card\)/);
      if (feature.startsWith("prefers-contrast")) expect(chrome).toMatch(/border-color:/);
      expect(block![1]).toMatch(/\.material-blur[\s\S]*backdrop-filter:\s*none/);
    }
  });

  // Anything that blurs what is behind it must opt in, or it ignores the user's setting.
  it("every file using a backdrop blur tags it material-chrome or material-blur", () => {
    const offenders = walk(src)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => !EXEMPT.some((e) => f.endsWith(e)))
      .filter((f) => /(?<![\w-])(?:[\w-]+:)*backdrop-blur/.test(readFileSync(f, "utf8")))
      .filter((f) => !/material-(chrome|blur)/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(src, f));
    expect(offenders).toEqual([]);
  });
});
