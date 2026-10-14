import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { instruments, prices } from "@portfolio/db";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { getPricesOn, priceKey } from "../../src/services/price-history.js";

describe("getPricesOn", () => {
  let a: string;
  let b: string;
  beforeAll(async () => {
    const db = await ensureDb();
    const mk = async (symbol: string) => {
      const [i] = await db
        .insert(instruments)
        .values({ symbol, market: "XETRA", assetClass: "etf", currency: "EUR", name: symbol })
        .returning();
      return i!.id;
    };
    a = await mk("PH-A");
    b = await mk("PH-B");
    await db.insert(prices).values([
      { instrumentId: a, date: "2025-01-01", close: "100", currency: "EUR" },
      { instrumentId: a, date: "2024-12-30", close: "99", currency: "EUR" },
      { instrumentId: a, date: "2025-12-29", close: "110", currency: "EUR" },
      // Beyond the 5-day window of 2025-12-31 and 2026-01-01 for B, but in window for 2024.
      { instrumentId: b, date: "2024-12-31", close: "50", currency: "USD" },
      { instrumentId: b, date: "2025-12-20", close: "60", currency: "USD" },
    ]);
  });
  afterAll(async () => {
    await closeDb();
  });

  it("returns the latest close on or before each date, per instrument", async () => {
    const out = await getPricesOn(getDb(), [a, b], ["2025-01-01", "2025-12-31", "2024-12-31"]);
    expect(out.get(priceKey(a, "2025-01-01"))).toEqual({ close: "100", currency: "EUR" });
    expect(out.get(priceKey(a, "2025-12-31"))).toEqual({ close: "110", currency: "EUR" });
    // 2024-12-31 falls back to the 2024-12-30 close (within the window).
    expect(out.get(priceKey(a, "2024-12-31"))).toEqual({ close: "99", currency: "EUR" });
    expect(out.get(priceKey(b, "2024-12-31"))).toEqual({ close: "50", currency: "USD" });
  });

  it("treats a close older than the lookback window as a miss", async () => {
    const out = await getPricesOn(getDb(), [b], ["2025-12-31"]);
    expect(out.has(priceKey(b, "2025-12-31"))).toBe(false);
    const wide = await getPricesOn(getDb(), [b], ["2025-12-31"], 11);
    expect(wide.get(priceKey(b, "2025-12-31"))).toEqual({ close: "60", currency: "USD" });
  });

  it("never uses a close after the requested date", async () => {
    const out = await getPricesOn(getDb(), [a], ["2025-12-28"]);
    expect(out.has(priceKey(a, "2025-12-28"))).toBe(false);
  });

  it("issues a single query regardless of the number of dates", async () => {
    const db = getDb();
    const spy = vi.spyOn(db, "select");
    await getPricesOn(db, [a, b], ["2024-12-31", "2025-01-01", "2025-12-31", "2026-01-01"]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("is empty (and query-free) for no instruments or no dates", async () => {
    const db = getDb();
    const spy = vi.spyOn(db, "select");
    expect((await getPricesOn(db, [], ["2025-01-01"])).size).toBe(0);
    expect((await getPricesOn(db, [a], [])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
