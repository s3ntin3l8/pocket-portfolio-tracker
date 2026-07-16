import { describe, it, expect, beforeAll } from "vitest";
import { toDateKey } from "@portfolio/core";
import { instruments, prices } from "@portfolio/db";
import { ensureDb } from "../../src/db/client.js";
import { loadSparklines } from "../../src/services/sparklines.js";

describe("loadSparklines", () => {
  let manyId: string; // 35 daily closes (exceeds the 30-point cap)
  let oneId: string; // a single close (too short to draw)
  let noneId: string; // no stored closes

  beforeAll(async () => {
    const db = await ensureDb();
    const mk = async (symbol: string) => {
      const [r] = await db
        .insert(instruments)
        .values({ symbol, market: "IDX", assetClass: "equity", currency: "IDR", name: symbol })
        .returning();
      return r.id;
    };
    manyId = await mk("SPK-MANY");
    oneId = await mk("SPK-ONE");
    noneId = await mk("SPK-NONE");

    const rows: { instrumentId: string; date: string; close: string; currency: string }[] = [];
    // 35 ascending daily closes 100..134, one per day.
    for (let i = 0; i < 35; i++) {
      const date = toDateKey(new Date(Date.UTC(2026, 0, 1 + i)));
      rows.push({ instrumentId: manyId, date, close: String(100 + i), currency: "IDR" });
    }
    rows.push({ instrumentId: oneId, date: "2026-02-01", close: "50", currency: "IDR" });
    await db.insert(prices).values(rows);
  });

  it("returns the most-recent 30 closes per instrument, oldest→newest", async () => {
    const db = await ensureDb();
    const map = await loadSparklines(db, [manyId, oneId, noneId]);
    const series = map.get(manyId);
    expect(series).toBeDefined();
    expect(series).toHaveLength(30); // capped at 30 of the 35
    // Newest 30 of values 100..134 are 105..134, returned ascending.
    expect(series![0]).toBe(105);
    expect(series![series!.length - 1]).toBe(134);
    for (let i = 1; i < series!.length; i++) {
      expect(series![i]).toBeGreaterThan(series![i - 1]);
    }
  });

  it("omits instruments with <2 closes and unknown ids", async () => {
    const db = await ensureDb();
    const map = await loadSparklines(db, [manyId, oneId, noneId]);
    expect(map.has(oneId)).toBe(false); // one close
    expect(map.has(noneId)).toBe(false); // no closes
  });

  it("returns an empty map for no ids", async () => {
    const db = await ensureDb();
    expect((await loadSparklines(db, [])).size).toBe(0);
  });
});
