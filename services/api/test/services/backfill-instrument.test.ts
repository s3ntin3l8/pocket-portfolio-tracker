/**
 * Direct tests for `fetchInstrumentPrices` (the per-instrument backfill sub-job, #761),
 * which previously had zero test coverage of its own — every existing backfill test
 * exercises it only indirectly through the (now-unused-by-the-scheduler) planner branch
 * or the inline path. See issue #773.
 *
 * Coverage:
 * 1. `tailOnly: true` suppresses the max-range provider fallback on a zero-candle
 *    result — the sub-job-side half of the #737/#749 dead-feed cooldown. This is the
 *    exact test that would have caught the regression where the sub-job hardcoded
 *    `allowMaxFallback: true` regardless of `tailOnly`, silently reverting that fix for
 *    the fan-out path.
 * 2. Without `tailOnly`, the fallback still fires and the miss counter resets on a hit.
 * 3. The truncation check is scoped to the CALLING portfolio, not global — an instrument
 *    held by two portfolios with different first-held dates must produce opposite
 *    `truncated` values depending on which `portfolioId` is passed.
 * 4. Basic day-count and unknown-instrument sanity checks.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { instruments, portfolios, prices, transactions, users } from "@portfolio/db";
import {
  MarketDataService,
  type MarketDataProvider,
  type InstrumentRef,
  type Candle,
} from "@portfolio/market-data";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { fetchInstrumentPrices } from "../../src/services/backfill.js";
import { upsertScrapedQuote, UBS_BUYBACK_KEY } from "../../src/services/scrapers/store.js";

/** Reports zero candles for `getHistoryFrom` always; `getHistory("max")` would return
 * real candles if called — tests assert it is NOT called under `tailOnly`. Mirrors
 * backfill-dead-feed.test.ts's provider of the same name. */
class GoneQuietProvider implements MarketDataProvider {
  readonly name = "gone-quiet";
  maxCallCount = 0;

  constructor(
    private readonly symbol: string,
    private readonly currency: string,
  ) {}

  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(): Promise<Candle[]> {
    return [];
  }
  async getHistory(ref: InstrumentRef): Promise<Candle[]> {
    if (ref.symbol !== this.symbol) return [];
    this.maxCallCount++;
    return [{ date: "2020-01-01", close: "100", currency: this.currency }];
  }
}

/** Returns a fixed candle list (filtered to `date >= fromDate`) regardless of which
 * portfolio is asking — used to prove the truncation check depends on the CALLER's
 * portfolio-scoped first-held date, not the candles themselves. */
class FixedCandleProvider implements MarketDataProvider {
  readonly name = "fixed-candle";

  constructor(
    private readonly symbol: string,
    private readonly candles: { date: string; close: string }[],
    private readonly currency: string,
  ) {}

  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(ref: InstrumentRef, fromDate: string): Promise<Candle[]> {
    if (ref.symbol !== this.symbol) return [];
    return this.candles
      .filter((c) => c.date >= fromDate)
      .map((c) => ({ ...c, currency: this.currency }));
  }
  async getHistory(ref: InstrumentRef): Promise<Candle[]> {
    if (ref.symbol !== this.symbol) return [];
    return this.candles.map((c) => ({ ...c, currency: this.currency }));
  }
}

const TODAY = new Date().toISOString().slice(0, 10);

describe("fetchInstrumentPrices (#761, #773)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("tailOnly suppresses the max-range provider fallback on a zero-candle result", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-tail-user", email: "instr-tail@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Tail", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "INSTRTAIL",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Instr Tail Corp",
      })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: instr.id,
        type: "buy",
        quantity: "1",
        price: "50",
        fees: "0",
        currency: "USD",
        executedAt: new Date("2026-02-01T10:00:00.000Z"),
      },
    ]);

    const provider = new GoneQuietProvider("INSTRTAIL", "USD");
    const svc = new MarketDataService([provider]);

    const result = await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: "2026-06-01",
      chunkEnd: TODAY,
      tailOnly: true,
    });

    expect(provider.maxCallCount).toBe(0);
    expect(result.unpriced).toBe(true);
    expect(result.days).toBe(0);

    const [row] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(row.priceFeedMissCount).toBe(1);
    expect(row.priceFeedLastMissAt).not.toBeNull();
  });

  it("without tailOnly, the fallback still fires and a hit resets the miss counter", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-nontail-user", email: "instr-nontail@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Non-Tail", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "INSTRNONTAIL",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Instr Non-Tail Corp",
      })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: instr.id,
        type: "buy",
        quantity: "1",
        price: "50",
        fees: "0",
        currency: "USD",
        executedAt: new Date("2026-02-01T10:00:00.000Z"),
      },
    ]);

    const provider = new GoneQuietProvider("INSTRNONTAIL", "USD");
    const svc = new MarketDataService([provider]);

    const result = await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: "2026-06-01",
      chunkEnd: TODAY,
      // tailOnly omitted — falls back to the max-range fetch, which GoneQuietProvider
      // answers with one real candle via getHistory().
    });

    expect(provider.maxCallCount).toBe(1);
    expect(result.unpriced).toBe(false);

    const [row] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(row.priceFeedMissCount).toBe(0);
    expect(row.priceFeedLastMissAt).toBeNull();
  });

  it("scopes the truncation check to the calling portfolio, not globally", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-scope-user", email: "instr-scope@example.com" })
      .returning();
    const [pfA] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Scope A", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [pfB] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Scope B", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "SHARED",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Shared Corp",
      })
      .returning();
    // Portfolio A held it from 2026-01-15 — earlier than the provider's earliest candle
    // (2026-03-01), so A's fetch is truncated.
    await db.insert(transactions).values([
      {
        portfolioId: pfA.id,
        instrumentId: instr.id,
        type: "buy",
        quantity: "1",
        price: "50",
        fees: "0",
        currency: "USD",
        executedAt: new Date("2026-01-15T10:00:00.000Z"),
      },
    ]);
    // Portfolio B held it from 2026-05-01 — later than the earliest candle, so B's
    // fetch is NOT truncated. Same instrument, same provider, opposite answer — this
    // fails against an unscoped (instrumentId-only) truncation query, which would
    // report `true` for both.
    await db.insert(transactions).values([
      {
        portfolioId: pfB.id,
        instrumentId: instr.id,
        type: "buy",
        quantity: "1",
        price: "50",
        fees: "0",
        currency: "USD",
        executedAt: new Date("2026-05-01T10:00:00.000Z"),
      },
    ]);

    const provider = new FixedCandleProvider(
      "SHARED",
      [{ date: "2026-03-01", close: "100" }],
      "USD",
    );
    const svc = new MarketDataService([provider]);

    const resultA = await fetchInstrumentPrices(db, svc, {
      portfolioId: pfA.id,
      instrumentId: instr.id,
      chunkStart: "2026-01-15",
      chunkEnd: TODAY,
    });
    expect(resultA.truncated).toBe(true);

    const resultB = await fetchInstrumentPrices(db, svc, {
      portfolioId: pfB.id,
      instrumentId: instr.id,
      chunkStart: "2026-01-15",
      chunkEnd: TODAY,
    });
    expect(resultB.truncated).toBe(false);
  });

  it("writes one price row per candle and reports the day count", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-days-user", email: "instr-days@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Days", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "INSTRDAYS",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Instr Days Corp",
      })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: instr.id,
        type: "buy",
        quantity: "1",
        price: "50",
        fees: "0",
        currency: "USD",
        executedAt: new Date("2026-03-01T10:00:00.000Z"),
      },
    ]);

    const provider = new FixedCandleProvider(
      "INSTRDAYS",
      [
        { date: "2026-03-01", close: "100" },
        { date: "2026-03-02", close: "101" },
        { date: "2026-03-03", close: "102" },
      ],
      "USD",
    );
    const svc = new MarketDataService([provider]);

    const result = await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: "2026-03-01",
      chunkEnd: "2026-03-03",
    });

    expect(result.days).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.unpriced).toBe(false);

    const rows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));
    expect(rows).toHaveLength(3);
  });

  it("stores candles in the provider's currency, not the instrument's declared one", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-ccy-user", email: "instr-ccy@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Ccy", baseCurrency: "EUR", cashCounted: false })
      .returning();
    // A USD-priced UCITS line on Xetra: declared EUR, quoted USD.
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "INSTRCCY",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        name: "Instr Ccy ETF",
      })
      .returning();
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: instr.id,
      type: "buy",
      quantity: "1",
      price: "15",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-03-01T10:00:00.000Z"),
    });

    const svc = new MarketDataService([
      new FixedCandleProvider(
        "INSTRCCY",
        [
          { date: "2026-03-01", close: "18.5" },
          { date: "2026-03-02", close: "18.6" },
        ],
        "USD",
      ),
    ]);

    await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: "2026-03-01",
      chunkEnd: "2026-03-02",
    });

    const rows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.currency === "USD")).toBe(true);
  });

  it("proxies a UBS gold instrument's history from XAU spot scaled by today's UBS buyback", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-ubs-user", email: "instr-ubs@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr UBS", baseCurrency: "IDR", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "UBS",
        market: "UBS",
        assetClass: "gold",
        currency: "IDR",
        name: "UBS Gold",
      })
      .returning();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: instr.id,
        type: "buy",
        quantity: "5",
        price: "2000000",
        fees: "0",
        currency: "IDR",
        executedAt: new Date(`${yesterday}T10:00:00.000Z`),
      },
    ]);
    await upsertScrapedQuote(db, UBS_BUYBACK_KEY, 2348000, "galeri24-ubs");

    // Spot 90 yesterday, 100 today → k = 2348000 / 100 = 23480 → yesterday's proxy 2113200.
    const svc = new MarketDataService([
      new FixedCandleProvider(
        "XAUIDR",
        [
          { date: yesterday, close: "90" },
          { date: TODAY, close: "100" },
        ],
        "IDR",
      ),
    ]);

    const result = await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: yesterday,
      chunkEnd: TODAY,
    });

    expect(result.unpriced).toBe(false);
    expect(result.days).toBe(2);
    const rows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));
    const byDate = new Map(rows.map((r) => [r.date, Number(r.close)]));
    expect(byDate.get(yesterday)).toBe(2113200);
    expect(byDate.get(TODAY)).toBe(2348000);
  });

  it("returns unpriced for an unknown instrument without touching the DB further", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "instr-unknown-user", email: "instr-unknown@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Instr Unknown", baseCurrency: "USD", cashCounted: false })
      .returning();

    const svc = new MarketDataService([]);
    const result = await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: "00000000-0000-0000-0000-000000000000",
      chunkStart: "2026-01-01",
      chunkEnd: TODAY,
    });

    expect(result).toEqual({
      instrumentId: "00000000-0000-0000-0000-000000000000",
      days: 0,
      truncated: false,
      unpriced: true,
    });
  });
});
