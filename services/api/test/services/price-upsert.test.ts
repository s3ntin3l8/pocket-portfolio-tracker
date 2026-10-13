import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { instruments, prices } from "@portfolio/db";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { upsertPriceRows } from "../../src/services/backfill/price-upsert.js";
import { chunk, UPSERT_CHUNK_SIZE } from "../../src/lib/chunk.js";

describe("chunk", () => {
  it("splits into slices of at most the chunk size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(UPSERT_CHUNK_SIZE).toBe(500);
  });
});

describe("upsertPriceRows (audit D6)", () => {
  let instrumentId: string;
  beforeAll(async () => {
    const db = await ensureDb();
    const [i] = await db
      .insert(instruments)
      .values({ symbol: "UPS", market: "IDX", assetClass: "equity", currency: "IDR", name: "U" })
      .returning();
    instrumentId = i.id;
  });
  afterAll(async () => {
    await closeDb();
  });

  it("writes 1200 rows in 3 statements and updates on conflict", async () => {
    const db = getDb();
    const rows = Array.from({ length: 1200 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1 + i));
      return { instrumentId, date: d.toISOString().slice(0, 10), close: "1", currency: "IDR" };
    });
    const insertSpy = vi.spyOn(db, "insert");
    await upsertPriceRows(db, rows);
    expect(insertSpy).toHaveBeenCalledTimes(3);
    insertSpy.mockRestore();

    await upsertPriceRows(
      db,
      rows.map((r) => ({ ...r, close: "2" })),
    );
    const stored = await db.select().from(prices).where(eq(prices.instrumentId, instrumentId));
    expect(stored).toHaveLength(1200);
    expect(stored.every((r) => r.close === "2")).toBe(true);
  });

  it("is a no-op for an empty list", async () => {
    const insertSpy = vi.spyOn(getDb(), "insert");
    await upsertPriceRows(getDb(), []);
    expect(insertSpy).not.toHaveBeenCalled();
    insertSpy.mockRestore();
  });
});
