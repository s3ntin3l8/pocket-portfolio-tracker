/**
 * A tail backfill (`fromDate`) must value its first days exactly like the full run does.
 *
 * Regression: the tail run only read prices from `fromDate` on. When `fromDate` was a
 * weekend there was no candle on its first grid days, `hasEverPriced` came back false, and
 * every holding was valued at cost for those days — a step down in `portfolio_snapshots`
 * (market value fell to cost) that the TWR chain then booked as a real loss, and a
 * "truncated" report for every instrument whose first stored price predates the window.
 *
 * Dates (2026): Fri 2026-10-16, Sat 10-17, Sun 10-18, Mon 10-19.
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
import { computeBackfillSnapshots } from "../../src/services/backfill/core.js";

const WEEKDAY_CANDLES: Record<string, string> = {
  "2026-10-05": "150",
  "2026-10-06": "150",
  "2026-10-07": "150",
  "2026-10-08": "150",
  "2026-10-09": "150",
  "2026-10-12": "150",
  "2026-10-13": "150",
  "2026-10-14": "150",
  "2026-10-15": "150",
  "2026-10-16": "150",
  "2026-10-19": "150",
  "2026-10-20": "150",
};

class WeekdayProvider implements MarketDataProvider {
  readonly name = "weekday-candles";
  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(_ref: InstrumentRef, fromDate: string): Promise<Candle[]> {
    return Object.entries(WEEKDAY_CANDLES)
      .filter(([d]) => d >= fromDate)
      .map(([date, close]) => ({ date, close, currency: "EUR" }));
  }
}

describe("tail backfill starting on a weekend", () => {
  let portfolioId: string;
  const svc = new MarketDataService([new WeekdayProvider()]);

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
      .values({ authSub: "tail-seed-user", email: "tail-seed@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Tail seed", baseCurrency: "EUR", cashCounted: false })
      .returning();
    portfolioId = pf.id;
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "TAILSEED",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Tail seed instrument",
      })
      .returning();
    // Bought at 100, priced at 150: cost (1000) and market value (1500) differ, so a day valued
    // at cost is distinguishable from a day carried at the last close.
    await db.insert(transactions).values({
      portfolioId,
      instrumentId: instr.id,
      type: "buy",
      quantity: "10",
      price: "100",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2026-10-05T10:00:00.000Z"),
    });
    // Full run: writes the prices and the whole snapshot series.
    await backfillPortfolioHistory(getDb(), svc, 10_000, portfolioId);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("the full run carries Friday's close over the weekend", async () => {
    const byDate = await snapshots();
    expect(Number(byDate.get("2026-10-17")!.marketValue)).toBe(1500);
    expect(Number(byDate.get("2026-10-18")!.marketValue)).toBe(1500);
  });

  it("an inline tail run from a Saturday matches the full run instead of dropping to cost", async () => {
    const before = await snapshots();
    const result = await backfillPortfolioHistory(getDb(), svc, 10_000, portfolioId, {
      fromDate: "2026-10-17",
      tailOnly: true,
    });
    const after = await snapshots();
    for (const d of ["2026-10-17", "2026-10-18", "2026-10-19"]) {
      expect(Number(after.get(d)!.marketValue), d).toBe(1500);
      expect(after.get(d)!.marketValue, d).toBe(before.get(d)!.marketValue);
    }
    // The first stored price (10-05) predates the tail window, so pricing didn't start late.
    expect(result.truncated).toEqual([]);
  });

  it("the fan-out snapshot pass (reads stored prices) matches too", async () => {
    const before = await snapshots();
    const result = await computeBackfillSnapshots(getDb(), portfolioId, {
      fromDate: "2026-10-18",
    });
    const after = await snapshots();
    expect(Number(after.get("2026-10-18")!.marketValue)).toBe(1500);
    expect(after.get("2026-10-18")!.marketValue).toBe(before.get("2026-10-18")!.marketValue);
    expect(result.truncated).toEqual([]);
  });

  it("a full run removes snapshots dated before the first transaction", async () => {
    const db = getDb();
    await db.insert(portfolioSnapshots).values({
      portfolioId,
      date: "2026-09-01",
      netWorth: "9999",
      marketValue: "9999",
      effectiveFlow: "0",
      currency: "EUR",
    });
    expect((await snapshots()).has("2026-09-01")).toBe(true);

    // A tail run leaves it (it only owns the window it rewrites)...
    await backfillPortfolioHistory(db, svc, 10_000, portfolioId, {
      fromDate: "2026-10-17",
      tailOnly: true,
    });
    expect((await snapshots()).has("2026-09-01")).toBe(true);

    // ...a full run owns the series from the first transaction, so the orphan goes.
    await backfillPortfolioHistory(db, svc, 10_000, portfolioId);
    expect((await snapshots()).has("2026-09-01")).toBe(false);
    expect((await snapshots()).has("2026-10-05")).toBe(true);
  });
});
