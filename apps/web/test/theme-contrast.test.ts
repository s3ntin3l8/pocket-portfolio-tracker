import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG contrast guard for the semantic text colours in `globals.css`. The tokens are plain hex
 * values, so this parses the `:root` and `.dark` blocks and checks each text colour against the
 * surfaces it is drawn on (card and page background, plus the muted surface for muted text).
 */
const css = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  // Fail loudly if a selector is renamed rather than slicing from -1.
  expect(start, `${selector} block not found in globals.css`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  const body = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+?)\s*(?:\/\*.*?\*\/)?\s*;/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

/** Resolve a `var(--x)` alias one or more levels to a literal hex value. */
function hexOf(map: Record<string, string>, token: string): string {
  let value = map[token];
  for (let i = 0; i < 5 && value && value.startsWith("var("); i++) {
    value = map[value.slice(6, -1)];
  }
  expect(value, `--${token} must resolve to a six-digit hex colour`).toMatch(/^#[0-9a-fA-F]{6}$/);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function over(fg: string, bg: string, alpha: number): string {
  const ch = (h: string, k: number) => parseInt(h.slice(k, k + 2), 16);
  const mixed = [1, 3, 5].map((k) => Math.round(alpha * ch(fg, k) + (1 - alpha) * ch(bg, k)));
  return `#${mixed.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const lightTokens = block(":root");
const darkOverrides = block(".dark");
const light = lightTokens;
const dark = { ...lightTokens, ...darkOverrides };

const TEXT = [
  "success",
  "destructive",
  "warning",
  "gold-fg",
  "info",
  "warn-soft",
  "muted-foreground",
  "foreground",
] as const;

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme text contrast", (_name, t) => {
  for (const token of TEXT) {
    for (const surface of ["card", "background"] as const) {
      it(`${token} on ${surface} is at least 4.5:1`, () => {
        expect(contrast(hexOf(t, token), hexOf(t, surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("muted-foreground on the muted surface is at least 4.5:1", () => {
    expect(contrast(hexOf(t, "muted-foreground"), hexOf(t, "muted"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("dark theme overrides", () => {
  it("defines every text token itself, so a deleted override cannot fall back to light values", () => {
    for (const token of TEXT) expect(darkOverrides, token).toHaveProperty(token);
  });
});

const FILES = (list: string[]) =>
  list.map((file) => [file, readFileSync(resolve(__dirname, "..", file), "utf8")] as const);

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s theme primary and tints", (_name, t) => {
  const surfaces = ["card", "background", "secondary", "muted"] as const;

  // Primary text (links, active nav) is never drawn on the secondary surface, where the light
  // green only clears 4.5:1 by a hair.
  for (const surface of ["card", "background", "muted"] as const) {
    it(`primary text on ${surface} is at least 4.5:1`, () => {
      expect(contrast(hexOf(t, "primary"), hexOf(t, surface))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the primary foreground on the primary fill is at least 4.5:1", () => {
    expect(contrast(hexOf(t, "primary-foreground"), hexOf(t, "primary"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("the warning foreground on the gold chip fill is at least 4.5:1", () => {
    expect(contrast(hexOf(t, "warning-foreground"), hexOf(t, "gold-fg"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("the destructive foreground on the destructive button fill, rest and hovered (/95), is at least 4.5:1", () => {
    const fill = hexOf(t, "destructive-fill");
    const fg = hexOf(t, "destructive-foreground");
    expect(contrast(fg, fill)).toBeGreaterThanOrEqual(4.5);
    for (const surface of surfaces) {
      expect(contrast(fg, over(fill, hexOf(t, surface), 0.95)), surface).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  // Badge and chip tints are 10% of the colour over the surface; the text colour is the
  // stronger token so it clears 4.5:1 on its own tint.
  const TINTS = [
    ["success", "success-strong"],
    ["destructive", "destructive-strong"],
    ["warning", "warn-strong"],
    ["primary", "primary-strong"],
  ] as const;
  for (const [fill, text] of TINTS) {
    for (const surface of surfaces) {
      it(`${text} on its 10% ${fill} tint over ${surface} is at least 4.5:1`, () => {
        const tint = over(hexOf(t, fill), hexOf(t, surface), 0.1);
        expect(contrast(hexOf(t, text), tint)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("light theme primary button hover", () => {
  it("white on the deeper hover fill is at least 4.5:1", () => {
    expect(
      contrast(hexOf(light, "primary-foreground"), hexOf(light, "primary-deep")),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("dark theme primary button hover", () => {
  it("the near-black foreground on the /90 hovered fill is at least 4.5:1 over the card", () => {
    const hovered = over(hexOf(dark, "primary"), hexOf(dark, "card"), 0.9);
    expect(contrast(hexOf(dark, "primary-foreground"), hovered)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("solid fill classes in source", () => {
  it("every destructive button uses the dedicated fill with a /95 hover", () => {
    for (const [file, src] of FILES([
      "src/components/ui/button.tsx",
      "src/components/portfolio-form-dialog.tsx",
      "src/components/portfolio-edit-form.tsx",
      "src/components/holder-edit-form.tsx",
    ])) {
      expect(src, file).toContain("bg-destructive-fill");
      expect(src, file).toContain("hover:bg-destructive-fill/95");
    }
  });

  it("the needs-review badges pair their fills with foreground tokens, not hard-coded white", () => {
    for (const [file, code] of FILES([
      "src/components/app-shell.tsx",
      "src/components/bottom-nav.tsx",
    ])) {
      expect(code, file).toContain("bg-destructive-fill text-destructive-foreground");
      expect(code, file).toContain("bg-gold-fg text-warning-foreground");
      expect(code, file).not.toContain("text-white");
    }
  });

  it("tinted backgrounds (/10, /15) never carry the plain text token, only its -strong tier", () => {
    const tint = /(?<![\w:-])bg-(success|destructive|warning|primary|gold-fg)\/(?:10|15)\b/;
    const literals = /"[^"\n]*"|`[^`\n]*`/g;
    const files = readdirSync(resolve(__dirname, "../src"), {
      recursive: true,
      encoding: "utf8",
    }).filter((f) => /\.tsx?$/.test(f));
    const offenders: string[] = [];
    for (const f of files) {
      const code = readFileSync(resolve(__dirname, "../src", f), "utf8");
      for (const lit of code.match(literals) ?? []) {
        const m = tint.exec(lit);
        if (m && new RegExp(`(?<![\\w:-])text-${m[1]}(?![\\w-])`).test(lit))
          offenders.push(`${f}: ${lit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The logo mark (`bg-brand text-white` in brand.tsx) is exempt from WCAG 1.4.3 (logotype), so
  // `bg-brand` is deliberately not part of this scan.
  it("no component pairs a brand fill with hard-coded white text", () => {
    const glob = [
      ...readdirSync(resolve(__dirname, "../src/components"), {
        recursive: true,
        encoding: "utf8",
      }),
    ].filter((f) => f.endsWith(".tsx"));
    for (const f of glob) {
      const src = readFileSync(resolve(__dirname, "../src/components", f), "utf8");
      expect(src, f).not.toMatch(/bg-primary[^"`']*text-white/);
      expect(src, f).not.toMatch(/bg-gold-fg[^"`']*text-white/);
    }
  });
});
