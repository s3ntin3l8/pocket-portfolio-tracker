/**
 * A dead feed (delisted, bankrupt, a bogus symbol: DEAD_FEED_MISS_THRESHOLD+ misses, the
 * last one inside the cooldown) must not be asked again by ANY backfill trigger, `force`
 * included — the fetch can't change a number, since valuation reads the stored prices and a
 * holding with none is valued at cost. After the cooldown, or with `retryDeadFeeds`, it is
 * asked again.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  instruments,
  portfolios,
  portfolioSnapshots,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import { DEAD_FEED_MISS_THRESHOLD } from "@portfolio/core";
import {
  MarketDataService,
  type Candle,
  type InstrumentRef,
  type MarketDataProvider,
} from "@portfolio/market-data";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { backfillPortfolioHistory, fetchInstrumentPrices } from "../../src/services/backfill.js";
import { planFanOut } from "../../src/services/backfill/fan-out.js";

const DAY = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

let seq = 0;

/** A provider that records every history request and returns a flat series for `symbol`. */
function spyProvider(symbol: string, calls: string[]): MarketDataProvider {
  return {
    name: "spy",
    supports: () => true,
    getQuote: async () => null,
    getHistoryFrom: async (ref: InstrumentRef, from: string): Promise<Candle[]> => {
      calls.push(ref.symbol);
      if (ref.symbol !== symbol) return [];
      return Array.from({ length: 30 }, (_, i) => ({
        date: ago(30 - i),
        close: "12",
        currency: "EUR",
      })).filter((c) => c.date >= from);
    },
  };
}

async function seed(opts: { missCount: number; lastMissDaysAgo?: number; sold?: boolean }) {
  const db = await ensureDb();
  const tag = `deadfeed${++seq}`;
  const [u] = await db
    .insert(users)
    .values({ authSub: `${tag}-user`, email: `${tag}@example.com` })
    .returning();
  const [pf] = await db
    .insert(portfolios)
    .values({ userId: u.id, name: tag, baseCurrency: "EUR", cashCounted: false })
    .returning();
  const [instr] = await db
    .insert(instruments)
    .values({
      symbol: tag.toUpperCase(),
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: tag,
      priceFeedMissCount: opts.missCount,
      priceFeedLastMissAt:
        opts.missCount > 0 ? new Date(Date.now() - (opts.lastMissDaysAgo ?? 0) * DAY) : null,
    })
    .returning();
  await db.insert(transactions).values({
    portfolioId: pf.id,
    instrumentId: instr.id,
    type: "buy",
    quantity: "2",
    price: "10",
    fees: "0",
    currency: "EUR",
    executedAt: new Date(`${ago(40)}T10:00:00.000Z`),
  });
  if (opts.sold) {
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: instr.id,
      type: "sell",
      quantity: "2",
      price: "11",
      fees: "0",
      currency: "EUR",
      executedAt: new Date(`${ago(35)}T10:00:00.000Z`),
    });
  }
  return { db, pf, instr, symbol: tag.toUpperCase() };
}

describe("backfill — a dead feed is not asked again", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("skips a dead feed in the inline backfill and values it from the stored prices", async () => {
    const { db, pf, instr, symbol } = await seed({ missCount: DEAD_FEED_MISS_THRESHOLD });
    await db.insert(prices).values(
      Array.from({ length: 6 }, (_, i) => ({
        instrumentId: instr.id,
        date: ago(40 - i),
        close: "15",
        currency: "EUR",
      })),
    );
    const calls: string[] = [];
    await backfillPortfolioHistory(
      db,
      new MarketDataService([spyProvider(symbol, calls)]),
      10_000,
      pf.id,
    );
    expect(calls).toEqual([]);
    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    // The stored 15 (not the cost of 10, not the spy's 12) values the 2 units.
    expect(Number(snaps.find((s) => s.date === ago(38))!.marketValue)).toBe(30);
    const [after] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(after!.priceFeedMissCount).toBe(DEAD_FEED_MISS_THRESHOLD); // no new miss recorded
  });

  it("skips a dead feed in the per-instrument fan-out chunk, held or closed", async () => {
    for (const sold of [false, true]) {
      const { db, pf, instr, symbol } = await seed({ missCount: DEAD_FEED_MISS_THRESHOLD, sold });
      const calls: string[] = [];
      const res = await fetchInstrumentPrices(
        db,
        new MarketDataService([spyProvider(symbol, calls)]),
        {
          portfolioId: pf.id,
          instrumentId: instr.id,
          chunkStart: ago(40),
          chunkEnd: ago(0),
        },
      );
      expect(calls, `sold=${sold}`).toEqual([]);
      expect(res.days).toBe(0);
    }
  });

  it("asks again once the cooldown has lapsed", async () => {
    const { db, pf, instr, symbol } = await seed({
      missCount: DEAD_FEED_MISS_THRESHOLD,
      lastMissDaysAgo: DEAD_FEED_MISS_THRESHOLD + 1,
    });
    const calls: string[] = [];
    await fetchInstrumentPrices(db, new MarketDataService([spyProvider(symbol, calls)]), {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(40),
      chunkEnd: ago(0),
    });
    expect(calls).toEqual([symbol]);
  });

  it("retryDeadFeeds asks a cooling-down dead feed, inline and through the fan-out plan", async () => {
    const { db, pf, instr, symbol } = await seed({ missCount: DEAD_FEED_MISS_THRESHOLD });
    const calls: string[] = [];
    const svc = new MarketDataService([spyProvider(symbol, calls)]);
    await backfillPortfolioHistory(db, svc, 10_000, pf.id, { retryDeadFeeds: true });
    expect(calls).toEqual([symbol]);

    const plan = await planFanOut(db, pf.id, { retryDeadFeeds: true });
    expect(plan.subJobs.every((j) => j.retryDeadFeeds === true)).toBe(true);
    const plain = await planFanOut(db, pf.id);
    expect(plain.subJobs.some((j) => "retryDeadFeeds" in j)).toBe(false);

    await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(40),
      chunkEnd: ago(0),
      retryDeadFeeds: true,
    });
    expect(calls).toEqual([symbol, symbol]);
  });

  it("an alive feed (below the threshold) is fetched as before", async () => {
    const { db, pf, symbol } = await seed({ missCount: DEAD_FEED_MISS_THRESHOLD - 1 });
    const calls: string[] = [];
    await backfillPortfolioHistory(
      db,
      new MarketDataService([spyProvider(symbol, calls)]),
      10_000,
      pf.id,
    );
    expect(calls).toEqual([symbol]);
  });
});
