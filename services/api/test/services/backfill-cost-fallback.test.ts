/**
 * Tests for issue #744: an instrument with no usable price is valued at its cost
 * basis in the historical backfill, not skipped — and the forward-fill that carries
 * a stale-but-real price forward is bounded to MAX_PRICE_CARRY_FORWARD_DAYS rather
 * than unbounded, so a genuinely delisted feed eventually reverts to "no price at
 * all" (cost fallback) instead of showing a years-old close forever.
 *
 * COVERED: priced for its first four days, then the feed goes silent — a real
 * in-series gap. Within the carry-forward window it should still show the carried
 * price; beyond the window it should be EXCLUDED (unchanged pre-#744 behavior for
 * a holding that has been priced before — see buildDailyValueFlows's hasEverPriced
 * doc comment for why this must NOT fall back to cost).
 *
 * NEVER: no candles at all, ever — the MWOF case. Valued at cost basis on every
 * day, including day one.
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

class PartialCandleProvider implements MarketDataProvider {
  readonly name = "partial-candles";

  constructor(
    private readonly symbol: string,
    /** Map of YYYY-MM-DD → close price. Empty for a symbol that's never covered. */
    private readonly candles: Record<string, string>,
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
    return Object.entries(this.candles)
      .filter(([date]) => date >= fromDate)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, close]) => ({ date, close, currency: this.currency }));
  }
}

const INCEPTION = "2026-08-01";
// COVERED is priced for its first four days, then the feed goes silent.
const COVERED_CANDLES: Record<string, string> = {
  [INCEPTION]: "100",
  "2026-08-02": "100",
  "2026-08-03": "100",
  "2026-08-04": "100", // last real candle
};
const WITHIN_BOUND_DATE = "2026-08-06"; // 2 days after the last candle — carried forward
const BEYOND_BOUND_DATE = "2026-08-20"; // 16 days after — past MAX_PRICE_CARRY_FORWARD_DAYS (10)

describe("backfillPortfolioHistory — cost-basis fallback for unpriced holdings (#744)", () => {
  let portfolioId: string;

  const svc = new MarketDataService([
    new PartialCandleProvider("COVERED", COVERED_CANDLES, "IDR"),
    new PartialCandleProvider("NEVER", {}, "IDR"),
  ]);

  beforeAll(async () => {
    const db = await ensureDb();

    const [u] = await db
      .insert(users)
      .values({ authSub: "cost-fallback-user", email: "cost-fallback@example.com" })
      .returning();

    const [pf] = await db
      .insert(portfolios)
      .values({
        userId: u.id,
        name: "Cost Fallback Test Portfolio",
        baseCurrency: "IDR",
        cashCounted: false, // MV is the only thing in the value
      })
      .returning();
    portfolioId = pf.id;

    const [covered] = await db
      .insert(instruments)
      .values({
        symbol: "COVERED",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Covered-then-silent instrument",
      })
      .returning();

    const [never] = await db
      .insert(instruments)
      .values({
        symbol: "NEVER",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Never-priced instrument",
      })
      .returning();

    await db.insert(transactions).values([
      {
        portfolioId,
        instrumentId: covered.id,
        type: "buy",
        quantity: "1",
        price: "100",
        fees: "0",
        currency: "IDR",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
      {
        portfolioId,
        instrumentId: never.id,
        type: "buy",
        quantity: "1",
        price: "50",
        fees: "0",
        currency: "IDR",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    await backfillPortfolioHistory(getDb(), svc, 10_000, portfolioId);
  });

  afterAll(async () => {
    await closeDb();
  });

  async function snapshotsByDate() {
    const snaps = await getDb()
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, portfolioId));
    return new Map(snaps.map((s) => [s.date, s]));
  }

  it("values NEVER at cost basis (50) on day one, not zero", async () => {
    const byDate = await snapshotsByDate();
    const day1 = byDate.get(INCEPTION);
    expect(day1, "inception snapshot must exist").toBeDefined();
    // COVERED priced at 100 + NEVER at cost basis 50.
    expect(Number(day1!.marketValue)).toBe(150);
    expect(Number(day1!.netWorth)).toBe(150);
  });

  it("carries COVERED's last real price forward within the carry-forward bound", async () => {
    const byDate = await snapshotsByDate();
    const within = byDate.get(WITHIN_BOUND_DATE);
    expect(within, "within-bound snapshot must exist").toBeDefined();
    // COVERED still carried at 100 (in-series carry-forward) + NEVER at cost 50.
    expect(Number(within!.marketValue)).toBe(150);
  });

  it("excludes COVERED once its gap exceeds the carry-forward bound — NOT a cost fallback", async () => {
    const byDate = await snapshotsByDate();
    const beyond = byDate.get(BEYOND_BOUND_DATE);
    expect(beyond, "beyond-bound snapshot must exist").toBeDefined();
    // COVERED excluded (has been priced before — a gap, not "never priced", so it
    // does NOT fall back to cost). Only NEVER's cost basis (50) remains.
    expect(Number(beyond!.marketValue)).toBe(50);
    expect(Number(beyond!.netWorth)).toBe(50);
  });
});
