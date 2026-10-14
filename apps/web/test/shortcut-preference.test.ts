import { describe, it, expect } from "vitest";
import {
  SHORTCUTS_DISABLED_KEY,
  readShortcutsEnabled,
  writeShortcutsEnabled,
} from "../src/lib/shortcut-preference";
import { safeStorage } from "../src/lib/safe-storage";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    has: (k: string) => data.has(k),
  };
}

describe("shortcut preference", () => {
  it("defaults to enabled and round-trips", () => {
    const s = memoryStorage();
    expect(readShortcutsEnabled(s)).toBe(true);
    writeShortcutsEnabled(false, s);
    expect(s.has(SHORTCUTS_DISABLED_KEY)).toBe(true);
    expect(readShortcutsEnabled(s)).toBe(false);
    writeShortcutsEnabled(true, s);
    expect(s.has(SHORTCUTS_DISABLED_KEY)).toBe(false);
    expect(readShortcutsEnabled(s)).toBe(true);
  });

  it("stays enabled when storage is missing or throws", () => {
    expect(readShortcutsEnabled(null)).toBe(true);
    expect(() => writeShortcutsEnabled(false, null)).not.toThrow();
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readShortcutsEnabled(bad)).toBe(true);
    expect(() => writeShortcutsEnabled(false, bad)).not.toThrow();
  });
});

describe("safeStorage", () => {
  it("returns localStorage in jsdom", () => {
    expect(safeStorage()).toBe(window.localStorage);
  });
});
