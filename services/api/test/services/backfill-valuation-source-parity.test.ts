/**
 * Regression test for issue #775: the fan-out path (`computeBackfillSnapshots`, which
 * reads the FULL historical `prices` table) and the inline `RECOMPUTE_QUEUE` path
 * (`backfillPortfolioHistory`, which used to value only from this run's freshly-fetched
 * candles) must agree on net worth for a portfolio whose feed goes dead AFTER an earlier
 * run already wrote real price history for it.
 *
 * Pre-fix, `backfillPortfolioHistory` re-run with a totally dead feed built an empty
 * in-memory `rawPrices` map for the affected instrument, so `writeSnapshotSeries`'
 * `hasEverPriced` saw "never priced at all" and fell back to cost basis for EVERY day —
 * including days that had already been correctly priced by the prior run and are still
 * sitting in the `prices` table. `computeBackfillSnapshots`, which always reads that
 * table, did not have this problem. Post-fix, `backfillPortfolioHistory` merges
 * previously-persisted prices into `rawPrices` before computing snapshots, so both paths
 * carry the stale-but-real price forward (bounded by `MAX_PRICE_CARRY_FORWARD_DAYS`,
 * currently 10) instead of one of them silently reverting to cost basis.
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
import { backfillPortfolioHistory, computeBackfillSnapshots } from "../../src/services/backfill.js";

class PartialCandleProvider implements MarketDataProvider {
  readonly name = "partial-candles";
  constructor(
    private readonly symbol: string,
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

/** Resolves with zero candles for every symbol — simulates a feed that has gone
 *  entirely dark on a subsequent run (network outage, delisting, rate limit exhausted). */
class DeadProvider implements MarketDataProvider {
  readonly name = "dead";
  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(): Promise<Candle[]> {
    return [];
  }
}

const INCEPTION = "2026-08-01";
// The feed was healthy through here on the first run.
const LAST_REAL_CANDLE = "2026-08-04";
const REAL_CANDLES: Record<string, string> = {
  [INCEPTION]: "100",
  "2026-08-02": "100",
  "2026-08-03": "100",
  [LAST_REAL_CANDLE]: "100",
};
const WITHIN_BOUND_DATE = "2026-08-06"; // 2 days after the last real candle — carried forward
const BEYOND_BOUND_DATE = "2026-08-20"; // 16 days after — past MAX_PRICE_CARRY_FORWARD_DAYS (10)

describe("backfillPortfolioHistory vs computeBackfillSnapshots — valuation-source parity on a dead feed (#775)", () => {
  let portfolioId: string;

  beforeAll(async () => {
    const db = await ensureDb();

    const [u] = await db
      .insert(users)
      .values({ authSub: "valuation-parity-user", email: "valuation-parity@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({
        userId: u.id,
        name: "Valuation Parity Test Portfolio",
        baseCurrency: "IDR",
        cashCounted: false,
      })
      .returning();
    portfolioId = pf.id;

    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "FLAKY",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Goes-dead-after-first-run instrument",
      })
      .returning();

    // Cost basis (80) deliberately differs from the real market price (100) below, so
    // a snapshot reading 100 vs. 80 unambiguously distinguishes "carried real price"
    // from "fell back to cost basis" — with equal values the two would be
    // indistinguishable and the assertions below would pass even on the pre-fix code.
    await db.insert(transactions).values([
      {
        portfolioId,
        instrumentId: instr.id,
        type: "buy",
        quantity: "1",
        price: "80",
        fees: "0",
        currency: "IDR",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    // Run 1: feed is healthy, writes real prices for INCEPTION..LAST_REAL_CANDLE into
    // the `prices` table and computes the first snapshot series from them.
    const healthySvc = new MarketDataService([
      new PartialCandleProvider("FLAKY", REAL_CANDLES, "IDR"),
    ]);
    await backfillPortfolioHistory(db, healthySvc, 10_000, portfolioId);

    // Run 2: feed is now entirely dead (e.g. the next night's sweep hits an outage).
    // `backfillPortfolioHistory`'s own fetch this run returns nothing for FLAKY, but
    // the `prices` table still holds run 1's real candles.
    const deadSvc = new MarketDataService([new DeadProvider()]);
    await backfillPortfolioHistory(db, deadSvc, 10_000, portfolioId);
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

  it("does not collapse the whole history to cost basis on a dead re-run — early prices are carried from the DB", async () => {
    const byDate = await snapshotsByDate();
    const day1 = byDate.get(INCEPTION);
    expect(day1, "inception snapshot must exist").toBeDefined();
    // 100 (the real, merged-from-DB price), not 80 (cost basis) — the pre-fix code
    // reads 80 here because a totally dead re-fetch left `rawPrices` empty.
    expect(Number(day1!.marketValue)).toBe(100);
  });

  it("still carries the last real price forward within the carry-forward bound after the dead re-run", async () => {
    const byDate = await snapshotsByDate();
    const within = byDate.get(WITHIN_BOUND_DATE);
    expect(within, "within-bound snapshot must exist").toBeDefined();
    expect(Number(within!.marketValue)).toBe(100);
  });

  it("still excludes (not cost-fallback) once the gap exceeds the carry-forward bound after the dead re-run", async () => {
    const byDate = await snapshotsByDate();
    const beyond = byDate.get(BEYOND_BOUND_DATE);
    expect(beyond, "beyond-bound snapshot must exist").toBeDefined();
    // Excluded, not cost basis (80) — same semantics as a same-run gap (#744).
    expect(Number(beyond!.marketValue)).toBe(0);
    expect(Number(beyond!.netWorth)).toBe(0);
  });

  it("agrees with computeBackfillSnapshots (the fan-out path) on every pinned date", async () => {
    const inlineByDate = await snapshotsByDate();

    // computeBackfillSnapshots reads the same `prices` table state (run 2 merged from
    // it but never wrote anything new back) and recomputes the same series.
    await computeBackfillSnapshots(getDb(), portfolioId);
    const fanOutByDate = await snapshotsByDate();

    for (const date of [INCEPTION, WITHIN_BOUND_DATE, BEYOND_BOUND_DATE]) {
      expect(Number(fanOutByDate.get(date)!.marketValue), `marketValue on ${date}`).toBe(
        Number(inlineByDate.get(date)!.marketValue),
      );
      expect(Number(fanOutByDate.get(date)!.netWorth), `netWorth on ${date}`).toBe(
        Number(inlineByDate.get(date)!.netWorth),
      );
    }
  });
});
