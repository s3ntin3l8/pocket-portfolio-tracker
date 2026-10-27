/**
 * A primary feed that only keeps recent history leaves everything before its first candle
 * unpriced (and the stored rows there never refreshed). The backfill's gap-fill must ask the
 * providers behind it for that leading stretch, store the result in the series' currency and
 * value the holding at market, not cost/0, for those days.
 */
import { describe, it, expect, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  fxRates,
  instruments,
  portfolios,
  portfolioSnapshots,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import {
  MarketDataService,
  type Candle,
  type InstrumentRef,
  type MarketDataProvider,
} from "@portfolio/market-data";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { backfillPortfolioHistory } from "../../src/services/backfill.js";

const DAY = 86_400_000;
const day = (n: number) =>
  new Date(Date.parse("2026-08-01T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
/** Daily candles for Aug 1 + [from, to] days, all native USD. */
const series = (from: number, to: number, close: string): Candle[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    date: day(from + i),
    close,
    currency: "USD",
  }));

describe("backfill — leading history missing from the primary feed", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("fills the stretch before the primary's first candle from the next provider", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "prehistory-user", email: "prehistory@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Prehistory", baseCurrency: "EUR", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "PREHIST",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        name: "Prehistory",
      })
      .returning();
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: instr.id,
      type: "buy",
      quantity: "2",
      price: "9",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-08-01T10:00:00.000Z"),
    });
    // A stale, mislabelled row inside the leading stretch must be rewritten, not kept.
    await db
      .insert(prices)
      .values({ instrumentId: instr.id, date: day(5), close: "99", currency: "EUR" });
    await db.delete(fxRates).where(eq(fxRates.base, "USD"));
    await db.insert(fxRates).values(
      Array.from({ length: 40 }, (_, i) => ({
        base: "USD",
        quote: "EUR",
        rate: "0.5",
        date: day(i),
      })),
    );

    // Primary: only Aug 21+ (10 days). Fallback: the whole of August, a different close.
    const primary: MarketDataProvider = {
      name: "recent-only",
      supports: () => true,
      getQuote: async () => null,
      getHistoryFrom: async (ref: InstrumentRef, from: string) =>
        ref.symbol === "PREHIST" ? series(20, 29, "20").filter((c) => c.date >= from) : [],
    };
    const fallback: MarketDataProvider = {
      name: "full-history",
      supports: () => true,
      getQuote: async () => null,
      getHistoryFrom: async (ref: InstrumentRef, from: string) =>
        ref.symbol === "PREHIST" ? series(0, 29, "30").filter((c) => c.date >= from) : [],
    };

    await backfillPortfolioHistory(db, new MarketDataService([primary, fallback]), 10_000, pf.id);

    const early = await db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, instr.id), eq(prices.date, day(5))));
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ close: "30", currency: "USD" });
    const kept = await db
      .select()
      .from(prices)
      .where(and(eq(prices.instrumentId, instr.id), eq(prices.date, day(25))));
    expect(kept[0]).toMatchObject({ close: "20", currency: "USD" }); // primary wins on overlap

    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    // 2 units × 30 USD × 0.5 = 30 EUR at market (cost would be 18).
    expect(Number(snaps.find((s) => s.date === day(5))!.marketValue)).toBe(30);
  });
});
