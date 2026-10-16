import { readFileSync } from "node:fs";
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

// A solid destructive fill with white text can only pass in the light theme: in dark the same
// token is also the text colour on the dark card, and no single value satisfies both.
describe("light theme destructive button", () => {
  const fill = hexOf(light, "destructive");
  const foreground = hexOf(light, "destructive-foreground");

  it("the destructive foreground on the destructive fill is at least 4.5:1", () => {
    expect(contrast(foreground, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it("stays at least 4.5:1 in the hover state (bg-destructive/95) on the card and the page", () => {
    for (const surface of ["card", "background"] as const) {
      const hovered = over(fill, hexOf(light, surface), 0.95);
      expect(contrast(foreground, hovered), surface).toBeGreaterThanOrEqual(4.5);
    }
  });
});
