import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Regression guard for the B2 follow-up: `collectFxMissing` is called at render time by
 * server components (Holdings, Activity, Reports). It must therefore never live in — or be
 * imported from — a `"use client"` module, otherwise React throws "Attempted to call
 * collectFxMissing() from the server" on every one of those pages. jsdom unit tests render
 * the banner alone and cannot catch that, so this test pins the module boundary.
 */
const webRoot = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(webRoot, rel), "utf8");

describe("collectFxMissing server/client boundary", () => {
  it("lives in a plain (non-client) module", () => {
    const src = read("src/lib/fx-missing.ts");
    expect(src).toMatch(/export function collectFxMissing/);
    expect(src).not.toMatch(/^\s*["']use client["']/m);
  });

  it("is not exported from the client banner module", () => {
    const banner = read("src/components/fx-missing-banner.tsx");
    expect(banner).toMatch(/^\s*["']use client["']/m);
    expect(banner).not.toMatch(/export function collectFxMissing/);
  });

  it("server pages import it from the lib module, not the banner", () => {
    for (const page of [
      "src/app/[locale]/(app)/holdings/page.tsx",
      "src/app/[locale]/(app)/reports/page.tsx",
      "src/app/[locale]/(app)/transactions/page.tsx",
    ]) {
      const src = read(page);
      expect(src, page).toMatch(/import \{ collectFxMissing \} from "@\/lib\/fx-missing"/);
      expect(src, page).not.toMatch(
        /collectFxMissing[^\n]*from "@\/components\/fx-missing-banner"/,
      );
    }
  });
});
