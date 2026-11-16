/**
 * `hasEverPriced` must be derived from the price rows valuation actually reads. Three places
 * where the stored `prices` history is not that:
 *  - a manual-price bond keeps a stored manual row, but its rawPrices stay empty (stays at cost);
 *  - a price row in a currency with no FX rate is dropped before valuation (#1179: at cost until
 *    the first convertible price);
 *  - the `prices` table is shared across portfolios, so a row from before this portfolio's first
 *    transaction must not make the instrument look priced for the days before its own candles.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  instruments,
  portfolios,
  portfolioSnapshots,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import {
  MarketDataService,
  type MarketDataProvider,
  type InstrumentRef,
  type Candle,
} from "@portfolio/market-data";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { backfillPortfolioHistory } from "../../src/services/backfill.js";
import { computeBackfillSnapshots } from "../../src/services/backfill/core.js";

class FromProvider implements MarketDataProvider {
  readonly name = "from-provider";
  constructor(private readonly candles: Record<string, string>) {}
  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(_ref: InstrumentRef, fromDate: string): Promise<Candle[]> {
    return Object.entries(this.candles)
      .filter(([d]) => d >= fromDate)
      .map(([date, close]) => ({ date, close, currency: "EUR" }));
  }
}

describe("backfill: earliest stored price must match what valuation reads", () => {
  let userId: string;

  async function portfolioWith(
    name: string,
    inst: { symbol: string; assetClass: "equity" | "bond"; manualPrice?: string },
    buy: { quantity: string; price: string },
  ) {
    const db = getDb();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId, name, baseCurrency: "EUR", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: inst.symbol,
        market: "XETRA",
        assetClass: inst.assetClass,
        currency: "EUR",
        name: inst.symbol,
        manualPrice: inst.manualPrice,
      })
      .returning();
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: instr.id,
      type: "buy",
      quantity: buy.quantity,
      price: buy.price,
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-10-01T10:00:00.000Z"),
    });
    return { portfolioId: pf.id, instrumentId: instr.id };
  }

  async function mv(portfolioId: string) {
    const rows = await getDb()
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, portfolioId));
    return new Map(rows.map((r) => [r.date, Number(r.marketValue)]));
  }

  beforeAll(async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "earliest-edge-user", email: "earliest-edge@example.com" })
      .returning();
    userId = u.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  it("a manual-price bond stays at cost around its stored manual price row", async () => {
    const { portfolioId, instrumentId } = await portfolioWith(
      "Manual bond",
      { symbol: "MANBOND", assetClass: "bond", manualPrice: "1000000" },
      { quantity: "1", price: "1000000" },
    );
    await getDb()
      .insert(prices)
      .values({ instrumentId, date: "2026-10-10", close: "1000000", currency: "EUR" });

    for (const run of ["inline", "fan-out"]) {
      if (run === "inline") {
        await backfillPortfolioHistory(
          getDb(),
          new MarketDataService([new FromProvider({})]),
          10_000,
          portfolioId,
        );
      } else {
        await computeBackfillSnapshots(getDb(), portfolioId);
      }
      const byDate = await mv(portfolioId);
      const before = byDate.get("2026-10-05")!;
      expect(before, `${run}: valued at cost before the manual row`).toBeGreaterThan(0);
      expect(byDate.get("2026-10-12"), `${run}: and not 0 after it`).toBe(before);
    }
  });

  it("a price row in a currency with no FX rate does not make the instrument look priced", async () => {
    const { portfolioId, instrumentId } = await portfolioWith(
      "Unconvertible price",
      { symbol: "NOFXPRICE", assetClass: "equity" },
      { quantity: "10", price: "100" },
    );
    await getDb()
      .insert(prices)
      .values({ instrumentId, date: "2026-10-05", close: "100", currency: "ZZZ" });

    await computeBackfillSnapshots(getDb(), portfolioId);
    const byDate = await mv(portfolioId);
    expect(byDate.get("2026-10-02")).toBe(1000);
    // Dropped row → still never priced → still at cost, not excluded to 0.
    expect(byDate.get("2026-10-06")).toBe(1000);
    expect(byDate.get("2026-10-12")).toBe(1000);
  });

  it("a price row from before the first transaction does not hide the cost fallback or truncation", async () => {
    const { portfolioId, instrumentId } = await portfolioWith(
      "Shared old price",
      { symbol: "SHAREDOLD", assetClass: "equity" },
      { quantity: "10", price: "100" },
    );
    // Another holder's history: a row long before this portfolio existed.
    await getDb()
      .insert(prices)
      .values({ instrumentId, date: "2025-01-02", close: "90", currency: "EUR" });

    const result = await backfillPortfolioHistory(
      getDb(),
      new MarketDataService([new FromProvider({ "2026-10-20": "150" })]),
      10_000,
      portfolioId,
    );
    const byDate = await mv(portfolioId);
    // No price for the first weeks of ITS history → at cost (1000), not excluded to 0.
    expect(byDate.get("2026-10-05")).toBe(1000);
    expect(byDate.get("2026-10-20")).toBe(1500);
    expect(result.truncated).toContain(instrumentId);
  });
});
