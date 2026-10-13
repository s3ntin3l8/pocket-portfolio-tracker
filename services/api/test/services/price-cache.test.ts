import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { instruments, lastPrices, portfolios, transactions, users } from "@portfolio/db";
import { MAX_PRICE_CARRY_FORWARD_DAYS } from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { getCachedQuotes, isStaleQuote, type PricedRef } from "../../src/services/price-cache.js";
import { valuePortfolio } from "../../src/services/valuation.js";

// A market-data service stub that counts how many times it's hit.
function service(price: string, counter: { n: number }): MarketDataService {
  return {
    getQuotes: async (refs: Array<{ id: string }>) => {
      counter.n++;
      const out: Record<string, { price: string; currency: string; asOf: string }> = {};
      for (const r of refs) {
        out[r.id] = { price, currency: "IDR", asOf: "2026-02-08T00:00:00.000Z" };
      }
      return out;
    },
  } as unknown as MarketDataService;
}

describe("getCachedQuotes", () => {
  let instrumentId: string;
  let ref: PricedRef;

  beforeAll(async () => {
    const db = await ensureDb();
    const [inst] = await db
      .insert(instruments)
      .values({
        symbol: "BBCA",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "BCA",
      })
      .returning();
    instrumentId = inst.id;
    ref = {
      id: inst.id,
      ref: { symbol: "BBCA", market: "IDX", assetClass: "equity", currency: "IDR" },
    };
  });

  afterAll(async () => {
    await closeDb();
  });

  it("misses then caches within the TTL and refreshes when stale", async () => {
    const db = getDb();
    const t0 = new Date("2026-02-08T10:00:00.000Z");
    const counter = { n: 0 };

    // Miss → live fetch + write-back.
    const a = await getCachedQuotes(db, service("9500", counter), [ref], 10_000, t0);
    expect(a[instrumentId]).toEqual({ price: "9500", currency: "IDR" });
    expect(counter.n).toBe(1);
    const [row] = await db
      .select()
      .from(lastPrices)
      .where(eq(lastPrices.instrumentId, instrumentId));
    expect(row.price).toBe("9500");

    // Within TTL → served from cache; the provider isn't called (newer price ignored).
    const b = await getCachedQuotes(
      db,
      service("9999", counter),
      [ref],
      10_000,
      new Date(t0.getTime() + 5_000),
    );
    expect(b[instrumentId]).toEqual({ price: "9500", currency: "IDR" });
    expect(counter.n).toBe(1);

    // Past TTL → re-fetch + update the cached row.
    const c = await getCachedQuotes(
      db,
      service("9800", counter),
      [ref],
      10_000,
      new Date(t0.getTime() + 20_000),
    );
    expect(c[instrumentId]).toEqual({ price: "9800", currency: "IDR" });
    expect(counter.n).toBe(2);
    const [updated] = await db
      .select()
      .from(lastPrices)
      .where(eq(lastPrices.instrumentId, instrumentId));
    expect(updated.price).toBe("9800");
  });

  it("returns an empty map for no refs without hitting the provider", async () => {
    const counter = { n: 0 };
    const out = await getCachedQuotes(getDb(), service("1", counter), [], 10_000);
    expect(out).toEqual({});
    expect(counter.n).toBe(0);
  });

  // Audit B13: a provider quote whose own `asOf` is older than MAX_PRICE_CARRY_FORWARD_DAYS
  // counts as missing — not served, not cached — so valuation falls to the cost path.
  describe("stale provider quotes", () => {
    function quoteService(asOf: string | undefined): MarketDataService {
      return {
        getQuotes: async (refs: Array<{ id: string }>) =>
          Object.fromEntries(
            refs.map((r) => [r.id, { price: "123", currency: "IDR", ...(asOf ? { asOf } : {}) }]),
          ),
      } as unknown as MarketDataService;
    }

    async function freshInstrument(): Promise<PricedRef> {
      const [inst] = await getDb()
        .insert(instruments)
        .values({
          symbol: `STALE-${crypto.randomUUID().slice(0, 8)}`,
          market: "IDX",
          assetClass: "equity",
          currency: "IDR",
          name: "Stale Co",
        })
        .returning();
      return {
        id: inst.id,
        ref: { symbol: inst.symbol, market: "IDX", assetClass: "equity", currency: "IDR" },
      };
    }

    const now = new Date("2026-03-31T12:00:00.000Z");

    it("drops a quote older than the carry-forward window and does not cache it", async () => {
      const r = await freshInstrument();
      const old = new Date(
        now.getTime() - (MAX_PRICE_CARRY_FORWARD_DAYS + 1) * 86_400_000,
      ).toISOString();
      const out = await getCachedQuotes(getDb(), quoteService(old), [r], 10_000, now);
      expect(out[r.id]).toBeUndefined();
      const cached = await getDb()
        .select()
        .from(lastPrices)
        .where(eq(lastPrices.instrumentId, r.id));
      expect(cached).toHaveLength(0);
    });

    it("keeps a quote inside the window, and one with no asOf at all", async () => {
      const r1 = await freshInstrument();
      const recent = new Date(
        now.getTime() - (MAX_PRICE_CARRY_FORWARD_DAYS - 1) * 86_400_000,
      ).toISOString();
      expect(
        (await getCachedQuotes(getDb(), quoteService(recent), [r1], 10_000, now))[r1.id],
      ).toEqual({
        price: "123",
        currency: "IDR",
      });
      const r2 = await freshInstrument();
      expect(
        (await getCachedQuotes(getDb(), quoteService(undefined), [r2], 10_000, now))[r2.id],
      ).toEqual({ price: "123", currency: "IDR" });
    });

    it("keeps a quote aged exactly the window and drops one a millisecond older", () => {
      // Strict `>` — same inclusive edge as valuation's historical carry-forward (`<=`).
      const windowMs = MAX_PRICE_CARRY_FORWARD_DAYS * 86_400_000;
      expect(isStaleQuote(new Date(now.getTime() - windowMs).toISOString(), now)).toBe(false);
      expect(isStaleQuote(new Date(now.getTime() - windowMs - 1).toISOString(), now)).toBe(true);
    });

    it("isStaleQuote treats missing/unparseable asOf as fresh", () => {
      expect(isStaleQuote(undefined, now)).toBe(false);
      expect(isStaleQuote("not-a-date", now)).toBe(false);
      expect(isStaleQuote("2020-01-01T00:00:00.000Z", now)).toBe(true);
    });

    // Wall-clock dependent: valuation.ts calls getCachedQuotes without its `now`, so the
    // staleness check runs against the real clock — the 2025-06-30 quote below is stale
    // for any run date after mid-July 2025, regardless of the `now` passed here.
    it("a stale quote leaves the holding valued at cost", async () => {
      const db = getDb();
      const [u] = await db
        .insert(users)
        .values({
          authSub: `stale-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.com`,
        })
        .returning();
      const [p] = await db
        .insert(portfolios)
        .values({ userId: u.id, name: "Stale", baseCurrency: "IDR", cashCounted: false })
        .returning();
      const r = await freshInstrument();
      await db.insert(transactions).values({
        portfolioId: p.id,
        instrumentId: r.id,
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "IDR",
        executedAt: new Date("2026-01-02"),
      });
      const v = await valuePortfolio(
        db,
        quoteService("2025-06-30T00:00:00.000Z"),
        10_000,
        p.id,
        "IDR",
        undefined,
        false,
        undefined,
        now,
      );
      const h = v.summary.holdings.find((x) => x.instrumentId === r.id)!;
      expect(h.valuedAtCost).toBe(true);
      expect(Number(h.marketValueDisplay)).toBe(1000);
    });
  });
});
