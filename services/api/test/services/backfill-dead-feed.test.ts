/**
 * Tests for #745 (fan-out via `opts.enqueue`), #737 (a permanently-dead price feed
 * must not re-trigger an unbounded provider fetch every sweep run), and #749 (a
 * provider that THROWS — network error, rate limit, auth failure — is not the same as
 * a provider that resolves with zero candles; they must be tracked separately).
 *
 * Coverage:
 * 1. `backfillPortfolioHistory({ tailOnly: true })` does NOT fall back to a max-range
 *    `getHistory` call when `getHistoryFrom` returns no candles — the whole point of a
 *    tail-only heal is that an empty window means "nothing new", not "fetch everything".
 * 2. `instruments.priceFeedMissCount`/`priceFeedLastMissAt` track consecutive misses and
 *    reset on a hit.
 * 3. `backfillStalePortfolios` stops marking a portfolio stale purely because of an
 *    instrument that is past `DEAD_FEED_MISS_THRESHOLD` misses and still cooling down.
 * 4. `backfillStalePortfolios({ enqueue })` enqueues instead of running inline: `queued`
 *    increments, `healed` stays 0, `portfolios` stays empty.
 * 5. #749 — `priceFeedMissCount` counts ALL failures (throws AND empty results) so that
 *    the dead-feed threshold isn't delayed by mixed-mode failures; `priceFeedErrorCount`
 *    tracks only the throw path for observability. A successful fetch resets BOTH
 *    counters. The sweep's `isCoolingDownDeadFeed` checks `priceFeedMissCount`, which
 *    now correctly reflects the total failure rate.
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
import { DEAD_FEED_MISS_THRESHOLD } from "@portfolio/core";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { backfillPortfolioHistory, backfillStalePortfolios } from "../../src/services/backfill.js";

/** Reports zero candles for `getHistoryFrom` always; `getHistory("max")` would return
 * real candles if called — tests assert it is NOT called under `tailOnly`. */
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

/** Throws on every fetch — simulates a network error / rate-limit / auth failure
 * (issue #749). Distinct from GoneQuietProvider: GoneQuietProvider resolves with `[]`,
 * this one rejects with an Error. */
class ThrowingProvider implements MarketDataProvider {
  readonly name = "throwing";
  constructor(
    private readonly symbol: string,
    private readonly message = "fetch failed: 503 Service Unavailable",
  ) {}

  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(_ref: InstrumentRef): Promise<Candle[]> {
    if (!_ref) throw new Error("sanity");
    throw new Error(this.message);
  }
  async getHistory(): Promise<Candle[]> {
    throw new Error(this.message);
  }
}

/** Throws for the configured symbol but resolves normally otherwise — lets a single
 * test exercise the error-on-some-symbols path without taking down the whole provider. */
class SelectiveThrowProvider implements MarketDataProvider {
  readonly name = "selective-throw";
  constructor(
    private readonly throwsOn: string,
    private readonly message = "auth key revoked",
  ) {}

  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(ref: InstrumentRef): Promise<Candle[]> {
    if (ref.symbol === this.throwsOn) throw new Error(this.message);
    return [{ date: "2020-01-01", close: "100", currency: ref.currency }];
  }
  async getHistory(ref: InstrumentRef): Promise<Candle[]> {
    if (ref.symbol === this.throwsOn) throw new Error(this.message);
    return [{ date: "2020-01-01", close: "100", currency: ref.currency }];
  }
}

const INCEPTION = "2026-02-01";

describe("backfill dead-feed handling (#737, #745)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("tailOnly suppresses the max-range provider fallback on a zero-candle result", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "dead-feed-tail-user", email: "dead-feed-tail@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Dead Feed Tail", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "GONEQUIET",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Gone Quiet Corp",
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    const provider = new GoneQuietProvider("GONEQUIET", "USD");
    const svc = new MarketDataService([provider]);

    const result = await backfillPortfolioHistory(db, svc, 10_000, pf.id, {
      fromDate: "2026-06-01",
      tailOnly: true,
    });

    expect(provider.maxCallCount).toBe(0);
    expect(result.unpriced).toContain(instr.id);

    const [row] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(row.priceFeedMissCount).toBe(1);
    expect(row.priceFeedLastMissAt).not.toBeNull();

    // A non-tailOnly (from-inception) heal DOES fall back to the max-range fetch.
    await backfillPortfolioHistory(db, svc, 10_000, pf.id);
    expect(provider.maxCallCount).toBe(1);

    // ...and a successful fetch resets the miss counter.
    const [rowAfterHit] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(rowAfterHit.priceFeedMissCount).toBe(0);
    expect(rowAfterHit.priceFeedLastMissAt).toBeNull();
  });

  it("stops marking a portfolio stale once its only stale instrument is past the dead-feed threshold and still cooling down", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "dead-feed-sweep-user", email: "dead-feed-sweep@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Dead Feed Sweep", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "STALEDEAD",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Stale Dead Corp",
        // Already past the dead-feed threshold, with its last miss "today" — cooling down.
        priceFeedMissCount: DEAD_FEED_MISS_THRESHOLD,
        priceFeedLastMissAt: new Date(),
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);
    // Snapshot history already reaches inception, and the only priced-instrument data
    // point is far older than MAX_PRICE_CARRY_FORWARD_DAYS — the ONLY reason this
    // portfolio would otherwise be flagged trailing-stale.
    await db.insert(prices).values({
      instrumentId: instr.id,
      date: "2026-01-01",
      close: "50",
      currency: "USD",
    });
    await backfillPortfolioHistory(getDb(), new MarketDataService([]), 10_000, pf.id);

    const svc = new MarketDataService([]);
    const result = await backfillStalePortfolios(db, svc, 10_000, {});

    expect(result.portfolios.find((p) => p.portfolioId === pf.id)).toBeUndefined();
  });

  it("enqueues instead of running inline when opts.enqueue is supplied", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "dead-feed-enqueue-user", email: "dead-feed-enqueue@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Enqueue Me", baseCurrency: "USD", cashCounted: false })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: null,
        type: "deposit",
        quantity: "0",
        price: "100",
        fees: "0",
        currency: "USD",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    const enqueued: { portfolioId: string; fromDate?: string; tailOnly?: boolean }[] = [];
    const result = await backfillStalePortfolios(db, new MarketDataService([]), 10_000, {
      enqueue: async (portfolioId, fromDate, tailOnly) => {
        enqueued.push({ portfolioId, fromDate, tailOnly });
        return true;
      },
    });

    expect(enqueued.some((e) => e.portfolioId === pf.id)).toBe(true);
    expect(result.healed).toBe(0);
    expect(result.queued).toBeGreaterThan(0);
    expect(result.enqueueFailed).toBe(0);
    expect(result.portfolios).toHaveLength(0);
  });

  it("counts a failed enqueue send separately from a successful one", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({
        authSub: "dead-feed-enqueue-fail-user",
        email: "dead-feed-enqueue-fail@example.com",
      })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Enqueue Fails", baseCurrency: "USD", cashCounted: false })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: null,
        type: "deposit",
        quantity: "0",
        price: "100",
        fees: "0",
        currency: "USD",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    // Simulates a DB hiccup on the send — enqueueBackfillPortfolio returns false in this
    // case (issue found in PR #746 review: the sweep used to count this as `queued`
    // regardless of the actual send outcome).
    const result = await backfillStalePortfolios(db, new MarketDataService([]), 10_000, {
      enqueue: async () => false,
    });

    expect(result.queued).toBe(0);
    expect(result.enqueueFailed).toBeGreaterThan(0);
  });

  it("scopes the sweep to a single user via opts.userId", async () => {
    const db = await ensureDb();
    const [u1] = await db
      .insert(users)
      .values({ authSub: "scope-user-1", email: "scope-user-1@example.com" })
      .returning();
    const [u2] = await db
      .insert(users)
      .values({ authSub: "scope-user-2", email: "scope-user-2@example.com" })
      .returning();
    const [pf1] = await db
      .insert(portfolios)
      .values({ userId: u1.id, name: "Scope Me", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [pf2] = await db
      .insert(portfolios)
      .values({ userId: u2.id, name: "Not Scope Me", baseCurrency: "USD", cashCounted: false })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf1.id,
        instrumentId: null,
        type: "deposit",
        quantity: "0",
        price: "100",
        fees: "0",
        currency: "USD",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
      {
        portfolioId: pf2.id,
        instrumentId: null,
        type: "deposit",
        quantity: "0",
        price: "100",
        fees: "0",
        currency: "USD",
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    const enqueued: string[] = [];
    await backfillStalePortfolios(db, new MarketDataService([]), 10_000, {
      userId: u1.id,
      enqueue: async (portfolioId) => {
        enqueued.push(portfolioId);
        return true;
      },
    });

    expect(enqueued).toContain(pf1.id);
    expect(enqueued).not.toContain(pf2.id);
  });
});

describe("backfill error vs miss distinction (#749)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("a provider throw increments both priceFeedMissCount and priceFeedErrorCount", async () => {
    // #749 — priceFeedMissCount counts ALL failures (throws AND empty results) so that
    // the dead-feed threshold isn't delayed by mixed-mode failures. priceFeedErrorCount
    // is observability-only — it tells an operator at a glance whether failures are
    // network/HTTP errors vs. legitimately empty feeds.
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "error-vs-miss-user", email: "error-vs-miss@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Error vs Miss", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "ERRAPI",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Erroring API Corp",
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    const svc = new MarketDataService([new ThrowingProvider("ERRAPI")]);
    const result = await backfillPortfolioHistory(db, svc, 10_000, pf.id, {
      fromDate: "2026-06-01",
      tailOnly: true,
    });

    expect(result.unpriced).toContain(instr.id);

    const [row] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(row.priceFeedMissCount).toBe(1);
    expect(row.priceFeedLastMissAt).not.toBeNull();
    expect(row.priceFeedErrorCount).toBe(1);
    expect(row.priceFeedLastErrorAt).not.toBeNull();
  });

  it("a successful fetch resets both miss and error counters", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "error-recovery-user", email: "error-recovery@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Error Recovery", baseCurrency: "USD", cashCounted: false })
      .returning();
    // Pre-seed BOTH counters past their defaults so we can prove both reset on a hit.
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "RECOVERED",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Recovered Corp",
        priceFeedMissCount: 3,
        priceFeedLastMissAt: new Date(),
        priceFeedErrorCount: 5,
        priceFeedLastErrorAt: new Date(),
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    const provider = new SelectiveThrowProvider("OTHER-SYMBOL");
    const svc = new MarketDataService([provider]);
    await backfillPortfolioHistory(db, svc, 10_000, pf.id);

    const [row] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(row.priceFeedMissCount).toBe(0);
    expect(row.priceFeedLastMissAt).toBeNull();
    expect(row.priceFeedErrorCount).toBe(0);
    expect(row.priceFeedLastErrorAt).toBeNull();
  });

  it("a miss-only failure increments priceFeedMissCount but not priceFeedErrorCount", async () => {
    // The inverse of the throw test: a provider that returns [] (legitimate empty
    // result) should increment priceFeedMissCount but leave priceFeedErrorCount at 0,
    // confirming the two bookkeeping paths are truly independent.
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "miss-only-user", email: "miss-only@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Miss Only", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "GONEQUIET2",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Gone Quiet 2 Corp",
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);

    const svc = new MarketDataService([new GoneQuietProvider("GONEQUIET2", "USD")]);
    const result = await backfillPortfolioHistory(db, svc, 10_000, pf.id, {
      fromDate: "2026-06-01",
      tailOnly: true,
    });

    expect(result.unpriced).toContain(instr.id);

    const [row] = await db.select().from(instruments).where(eq(instruments.id, instr.id));
    expect(row.priceFeedMissCount).toBe(1);
    expect(row.priceFeedLastMissAt).not.toBeNull();
    expect(row.priceFeedErrorCount).toBe(0);
    expect(row.priceFeedLastErrorAt).toBeNull();
  });

  it("the sweep stops marking a portfolio stale once its only stale instrument is past the failure threshold (via throw)", async () => {
    // #749 — priceFeedMissCount now counts throws too, so a feed that's been erroring
    // (e.g. auth key revoked) for a week accumulates priceFeedMissCount at the same rate
    // as one returning empty results, and the cooldown kicks in at the same threshold.
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "error-sweep-user", email: "error-sweep@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Error Sweep", baseCurrency: "USD", cashCounted: false })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "ERRORED",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Errored Corp",
        priceFeedMissCount: DEAD_FEED_MISS_THRESHOLD,
        priceFeedLastMissAt: new Date(),
        priceFeedErrorCount: DEAD_FEED_MISS_THRESHOLD,
        priceFeedLastErrorAt: new Date(),
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);
    // The only priced data point is far older than MAX_PRICE_CARRY_FORWARD_DAYS —
    // without the dead-feed cooldown exclusion, this portfolio would otherwise be
    // flagged trailing-stale purely because of the erroring feed.
    await db.insert(prices).values({
      instrumentId: instr.id,
      date: "2026-01-01",
      close: "50",
      currency: "USD",
    });
    await backfillPortfolioHistory(getDb(), new MarketDataService([]), 10_000, pf.id);

    const svc = new MarketDataService([]);
    const result = await backfillStalePortfolios(db, svc, 10_000, {});

    expect(result.portfolios.find((p) => p.portfolioId === pf.id)).toBeUndefined();
  });

  it("the sweep still marks a portfolio stale when failure count is below the threshold", async () => {
    // Inverse of the cooldown test — missCount < DEAD_FEED_MISS_THRESHOLD must NOT
    // trigger the cooldown, so a fresh (sub-threshold) failing feed still causes a
    // nightly re-fetch. The feed only earns the cooldown once it has been failing
    // consistently (whether by throw, empty result, or a mix of both).
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "error-subthreshold-user", email: "error-subthreshold@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({
        userId: u.id,
        name: "Error Sub-Threshold",
        baseCurrency: "USD",
        cashCounted: false,
      })
      .returning();
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: "SUBTHRESH",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "Sub-Threshold Corp",
        // Pre-seed 2 below the threshold: the backfillPortfolioHistory call below
        // will increment priceFeedMissCount by 1 (the empty MarketDataService
        // produces no candles), bringing it to DEAD_FEED_MISS_THRESHOLD - 1 — still
        // below the threshold, so the sweep must NOT exclude it from staleness.
        priceFeedMissCount: DEAD_FEED_MISS_THRESHOLD - 2,
        priceFeedLastMissAt: new Date(),
        priceFeedErrorCount: DEAD_FEED_MISS_THRESHOLD - 2,
        priceFeedLastErrorAt: new Date(),
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
        executedAt: new Date(`${INCEPTION}T10:00:00.000Z`),
      },
    ]);
    await db.insert(prices).values({
      instrumentId: instr.id,
      date: "2026-01-01",
      close: "50",
      currency: "USD",
    });
    // The backfill creates a snapshot so the sweep sees earliestSnapshot <= inception
    // and evaluates trailing staleness (rather than a full heal). It also increments
    // priceFeedMissCount by 1, keeping it below the threshold.
    await backfillPortfolioHistory(getDb(), new MarketDataService([]), 10_000, pf.id);

    const svc = new MarketDataService([]);
    const result = await backfillStalePortfolios(db, svc, 10_000, {});

    // The portfolio SHOULD appear as trailing-stale (daily price is far older than
    // MAX_PRICE_CARRY_FORWARD_DAYS, missCount hasn't yet hit the threshold to exclude
    // it from staleness scoring).
    expect(result.portfolios.find((p) => p.portfolioId === pf.id)).toBeDefined();
  });
});
