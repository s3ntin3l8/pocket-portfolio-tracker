import { describe, it, expect } from "vitest";
import {
  RECENT_MAX,
  RECENT_PAGES_KEY,
  readRecentPages,
  recordRecentPage,
  topLevelPath,
} from "../src/lib/recent-pages";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_PAGES_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const KNOWN = ["/holdings", "/tax", "/income", "/reports", "/insights", "/trades", "/savings"];

describe("recent pages", () => {
  it("normalises to the top-level segment", () => {
    expect(topLevelPath("/tax/2025")).toBe("/tax");
    expect(topLevelPath("/")).toBe("/");
  });

  it("records newest first, de-duplicated, ignoring unknown pages", () => {
    const s = memoryStorage();
    recordRecentPage("/tax", KNOWN, s);
    recordRecentPage("/holdings", KNOWN, s);
    recordRecentPage("/tax/2025", KNOWN, s);
    recordRecentPage("/instruments/abc", KNOWN, s);
    expect(readRecentPages(s)).toEqual(["/tax", "/holdings"]);
  });

  it("caps the list", () => {
    const s = memoryStorage();
    for (const p of KNOWN) recordRecentPage(p, KNOWN, s);
    expect(readRecentPages(s)).toHaveLength(RECENT_MAX);
    expect(readRecentPages(s)[0]).toBe("/savings");
  });

  it("tolerates corrupt storage", () => {
    expect(readRecentPages(memoryStorage("{nope"))).toEqual([]);
    expect(readRecentPages(memoryStorage('{"a":1}'))).toEqual([]);
    expect(readRecentPages(null)).toEqual([]);
  });
});
