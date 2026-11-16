/**
 * A holding whose feed went silent more than MAX_PRICE_CARRY_FORWARD_DAYS before a tail
 * run's `fromDate` is EXCLUDED by the full run ("priced before, but the gap exceeds the
 * window"), not valued at cost. The tail run must agree: it reads only prices from
 * `fromDate` on, so it has to learn from the whole price history that the instrument WAS
 * priced, or it would call it never-priced and bounce the series up to cost on its first day.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { instruments, portfolios, portfolioSnapshots, transactions, users } from "@portfolio/db";
import {
  MarketDataService,
  type MarketDataProvider,
  type InstrumentRef,
  type Candle,
} from "@portfolio/market-data";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { backfillPortfolioHistory } from "../../src/services/backfill.js";

// Priced on the first two days only; every later day is past the 10-day carry window by 10-13.
const CANDLES: Record<string, string> = { "2026-10-01": "150", "2026-10-02": "150" };

class SilentFeedProvider implements MarketDataProvider {
  readonly name = "silent-feed";
  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(_ref: InstrumentRef, fromDate: string): Promise<Candle[]> {
    return Object.entries(CANDLES)
      .filter(([d]) => d >= fromDate)
      .map(([date, close]) => ({ date, close, currency: "EUR" }));
  }
}

describe("tail backfill of a holding whose feed went silent before fromDate", () => {
  let portfolioId: string;
  const svc = new MarketDataService([new SilentFeedProvider()]);

  async function snapshots() {
    const rows = await getDb()
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, portfolioId));
    return new Map(rows.map((r) => [r.date, r]));
  }

  beforeAll(async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "tail-stale-user", email: "tail-stale@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Tail stale", baseCurrency: "EUR", cashCounted: false })
      .returning();
    portfolioId = pf.id;
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "TAILSTALE",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Tail stale instrument",
      })
      .returning();
    await db.insert(transactions).values({
      portfolioId,
      instrumentId: instr.id,
      type: "buy",
      quantity: "10",
      price: "100",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-10-01T10:00:00.000Z"),
    });
    await backfillPortfolioHistory(getDb(), svc, 10_000, portfolioId);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("the full run excludes the holding once its gap passes the carry window", async () => {
    expect(Number((await snapshots()).get("2026-10-20")!.marketValue)).toBe(0);
  });

  it("a tail run from well after the last candle agrees (excluded, not valued at cost)", async () => {
    const before = await snapshots();
    await backfillPortfolioHistory(getDb(), svc, 10_000, portfolioId, {
      fromDate: "2026-10-17",
      tailOnly: true,
    });
    const after = await snapshots();
    for (const d of ["2026-10-17", "2026-10-18", "2026-10-20"]) {
      expect(Number(after.get(d)!.marketValue), d).toBe(0);
      expect(after.get(d)!.marketValue, d).toBe(before.get(d)!.marketValue);
    }
  });
});
