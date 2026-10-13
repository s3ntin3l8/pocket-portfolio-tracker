import { describe, it, expect } from "vitest";
import { routing } from "../src/i18n/routing";
import { offlinePrecacheEntries } from "../src/i18n/offline-precache.mjs";

describe("offlinePrecacheEntries", () => {
  it("precaches the offline page of every routing locale (sw.ts falls back per locale)", () => {
    const entries = offlinePrecacheEntries(routing.locales, "rev");
    expect(entries.map((e) => e.url)).toEqual(routing.locales.map((l) => `/${l}/offline`));
    expect(entries.map((e) => e.url)).toContain("/id/offline");
    expect(entries.every((e) => e.revision === "rev")).toBe(true);
  });
});
