import { describe, it, expect } from "vitest";
import {
  RECENT_INSTRUMENTS_KEY,
  RECENT_INSTRUMENTS_MAX,
  readRecentInstruments,
  recordRecentInstrument,
} from "../src/lib/recent-instruments";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_INSTRUMENTS_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    raw: () => data.get(RECENT_INSTRUMENTS_KEY),
  };
}

describe("recent instruments", () => {
  it("records newest first and de-duplicates by id", () => {
    const s = memoryStorage();
    recordRecentInstrument({ id: "a", symbol: "AAA" }, s);
    recordRecentInstrument({ id: "b", symbol: "BBB" }, s);
    recordRecentInstrument({ id: "a", symbol: "AAA" }, s);
    expect(readRecentInstruments(s)).toEqual([
      { id: "a", symbol: "AAA" },
      { id: "b", symbol: "BBB" },
    ]);
  });

  it("stores only id and symbol", () => {
    const s = memoryStorage();
    recordRecentInstrument({ id: "a", symbol: "AAA", name: "Secret Corp", qty: "10" } as never, s);
    expect(JSON.parse(s.raw() as string)).toEqual([{ id: "a", symbol: "AAA" }]);
  });

  it("caps the list", () => {
    const s = memoryStorage();
    for (let i = 0; i < RECENT_INSTRUMENTS_MAX + 3; i++) {
      recordRecentInstrument({ id: `i${i}`, symbol: `S${i}` }, s);
    }
    const list = readRecentInstruments(s);
    expect(list).toHaveLength(RECENT_INSTRUMENTS_MAX);
    expect(list[0]?.id).toBe(`i${RECENT_INSTRUMENTS_MAX + 2}`);
  });

  it("drops malformed entries and tolerates bad JSON / missing storage", () => {
    expect(
      readRecentInstruments(
        memoryStorage(JSON.stringify([{ id: "a", symbol: "A", extra: 1 }, "x", { id: 1 }, null])),
      ),
    ).toEqual([{ id: "a", symbol: "A" }]);
    expect(readRecentInstruments(memoryStorage("{nope"))).toEqual([]);
    expect(readRecentInstruments(memoryStorage('{"a":1}'))).toEqual([]);
    expect(readRecentInstruments(null)).toEqual([]);
    expect(() => recordRecentInstrument({ id: "a", symbol: "A" }, null)).not.toThrow();
  });

  it("ignores empty ids/symbols and a throwing store", () => {
    const s = memoryStorage();
    recordRecentInstrument({ id: "", symbol: "A" }, s);
    recordRecentInstrument({ id: "a", symbol: "" }, s);
    expect(s.raw()).toBeUndefined();
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => recordRecentInstrument({ id: "a", symbol: "A" }, full)).not.toThrow();
  });
});
