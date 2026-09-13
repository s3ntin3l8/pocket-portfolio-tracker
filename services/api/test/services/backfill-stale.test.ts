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
import { toDateKey } from "@portfolio/core";
import { MarketDataService, FixtureProvider } from "@portfolio/market-data";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { backfillStalePortfolios } from "../../src/services/backfill.js";

/**
 * Tests for backfillStalePortfolios (#269).
 *
 * Uses PGlite + FixtureProvider so no external DB or market-data API is needed.
 * The FixtureProvider returns a fixed price for known symbols; the backfill engine
 * gracefully skips instruments with no history (logs a warning, continues).
 *
 * Coverage:
 * 1. A portfolio with no snapshots is detected as stale and healed (snapshots written
 *    from inception to today).
 * 2. A portfolio that is already fully backfilled (earliest snapshot == inception) is
 *    skipped — idempotency.
 * 3. Re-running the sweep after all portfolios are healed returns healed: 0.
 */
describe("backfillStalePortfolios", () => {
  let stalePortfolioId: string;
  let healedPortfolioId: string;
  let bondInstrId: string;

  const INCEPTION_DATE = "2026-01-15";
  const svc = new MarketDataService([new FixtureProvider({ BBCA: "9500" })]);

  beforeAll(async () => {
    const db = await ensureDb();

    const [u] = await db
      .insert(users)
      .values({ authSub: "stale-sweep-user", email: "stale-sweep@example.com" })
      .returning();

    // ── Stale portfolio: has transactions, but NO snapshots ──────────────────
    const [stale] = await db
      .insert(portfolios)
      .values({
        userId: u.id,
        name: "Stale Portfolio",
        baseCurrency: "IDR",
        cashCounted: true,
      })
      .returning();
    stalePortfolioId = stale.id;

    // Use a bond so the flat-faceValue path is exercised (no provider history needed).
    const [bond] = await db
      .insert(instruments)
      .values({
        symbol: "SBN001",
        market: "IDX",
        assetClass: "bond",
        currency: "IDR",
        name: "Test Bond",
        faceValue: "1000000",
      })
      .returning();
    bondInstrId = bond.id;

    await db.insert(transactions).values([
      {
        portfolioId: stalePortfolioId,
        instrumentId: bondInstrId,
        type: "buy",
        quantity: "1",
        price: "1000000",
        currency: "IDR",
        executedAt: new Date(`${INCEPTION_DATE}T10:00:00.000Z`),
      },
    ]);

    // ── Already-healed portfolio: has a snapshot exactly at inception ────────
    const [healed] = await db
      .insert(portfolios)
      .values({
        userId: u.id,
        name: "Healed Portfolio",
        baseCurrency: "IDR",
        cashCounted: false,
      })
      .returning();
    healedPortfolioId = healed.id;

    const [bbca] = await db
      .insert(instruments)
      .values({
        symbol: "BBCA",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "BCA",
      })
      .returning();

    const healedInception = "2026-01-10";
    await db.insert(transactions).values([
      {
        portfolioId: healedPortfolioId,
        instrumentId: bbca.id,
        type: "buy",
        quantity: "10",
        price: "9000",
        currency: "IDR",
        executedAt: new Date(`${healedInception}T10:00:00.000Z`),
      },
    ]);

    // Pre-seed a snapshot at inception so this portfolio looks fully healed.
    await db.insert(portfolioSnapshots).values({
      portfolioId: healedPortfolioId,
      date: healedInception,
      netWorth: "90000",
      marketValue: "90000",
      effectiveFlow: "0",
      currency: "IDR",
    });

    // A price dated "today" so this portfolio is also fully healed on the trailing
    // edge — otherwise it would be picked up by the trailing-staleness re-heal check
    // (a portfolio with a snapshot but no price history at all is exactly the kind of
    // gap that check exists to catch), breaking the idempotency assertions below.
    await db.insert(prices).values({
      instrumentId: bbca.id,
      date: toDateKey(new Date()),
      close: "9500",
      currency: "IDR",
    });
  });

  afterAll(async () => {
    await closeDb();
  });

  it("detects the stale portfolio and writes snapshots from inception", async () => {
    const db = getDb();
    const result = await backfillStalePortfolios(db, svc, 10_000);

    // At least the stale portfolio must have been healed.
    expect(result.healed).toBeGreaterThanOrEqual(1);

    // The stale portfolio should appear in the healed list.
    const healedEntry = result.portfolios.find((p) => p.portfolioId === stalePortfolioId);
    expect(healedEntry).toBeDefined();
    expect(healedEntry!.result.days).toBeGreaterThan(0);

    // Snapshots must now exist for the stale portfolio, starting no later than inception.
    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, stalePortfolioId));
    expect(snaps.length).toBeGreaterThan(0);

    const dates = snaps.map((s) => s.date).sort();
    // Earliest snapshot must be on or before the inception date (ISO string comparison is valid).
    expect(dates[0]! <= INCEPTION_DATE).toBe(true);
  });

  it("skips the already-healed portfolio (idempotency check before second run)", async () => {
    const db = getDb();
    const result = await backfillStalePortfolios(db, svc, 10_000);

    const healedEntry = result.portfolios.find((p) => p.portfolioId === healedPortfolioId);
    // The pre-seeded portfolio should NOT appear in the healed list.
    expect(healedEntry).toBeUndefined();
  });

  it("returns healed: 0 when all portfolios are already healed (sweep is idempotent)", async () => {
    const db = getDb();
    // Run a third time — both portfolios now have full history, nothing to do.
    const result = await backfillStalePortfolios(db, svc, 10_000);

    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.healed).toBe(0);
    expect(result.portfolios).toHaveLength(0);
  });

  // Regression guard: a portfolio that is fully backfilled from inception can still
  // have its price feed stop updating weeks later. The earliest-snapshot check alone
  // never re-visits it once healed once — this is the trailing-edge check that does.
  it("re-heals a portfolio whose price feed has gone stale at the trailing edge, even though it's fully backfilled from inception", async () => {
    const db = getDb();

    const [u] = await db
      .insert(users)
      .values({ authSub: "trailing-stale-user", email: "trailing-stale@example.com" })
      .returning();

    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Trailing Stale", baseCurrency: "IDR", cashCounted: true })
      .returning();

    // A bond, so the flat-faceValue backfill path is exercised (no live provider
    // history needed) — same trick the "stale portfolio" fixture above uses.
    const [bond] = await db
      .insert(instruments)
      .values({
        symbol: "TRAILBOND",
        market: "IDX",
        assetClass: "bond",
        currency: "IDR",
        name: "Trailing Bond",
        faceValue: "1000000",
      })
      .returning();

    const inceptionDate = "2025-01-01";
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: bond.id,
      type: "buy",
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: new Date(`${inceptionDate}T10:00:00.000Z`),
    });

    // A snapshot at inception — the portfolio looks fully healed by the
    // earliest-snapshot check alone.
    await db.insert(portfolioSnapshots).values({
      portfolioId: pf.id,
      date: inceptionDate,
      netWorth: "1000000",
      marketValue: "1000000",
      effectiveFlow: "1000000",
      currency: "IDR",
    });

    // The bond's last price is 60 days behind "today" — well past
    // MAX_PRICE_CARRY_FORWARD_DAYS — with nothing more recent.
    const staleDate = toDateKey(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));
    await db.insert(prices).values({
      instrumentId: bond.id,
      date: staleDate,
      close: "1000000",
      currency: "IDR",
    });

    const result = await backfillStalePortfolios(db, svc, 10_000);

    const healedEntry = result.portfolios.find((p) => p.portfolioId === pf.id);
    expect(healedEntry).toBeDefined();

    // The gap is now closed: the bond has a price through today.
    const bondPrices = await db.select().from(prices).where(eq(prices.instrumentId, bond.id));
    const latest = bondPrices
      .map((p) => p.date)
      .sort()
      .at(-1);
    expect(latest).toBe(toDateKey(new Date()));

    // A second run finds nothing left to heal for this portfolio.
    const second = await backfillStalePortfolios(db, svc, 10_000);
    expect(second.portfolios.find((p) => p.portfolioId === pf.id)).toBeUndefined();
  });

  // Regression guard: an instrument the portfolio fully exited years ago must not mark
  // it trailing-stale forever — that instrument's price naturally stops updating (no
  // one refreshes prices for a position nobody holds anymore), and counting it against
  // the portfolio would trigger a re-fetch attempt (and, if the provider ever returns
  // no data for a partial range, a full historical re-backfill per core.ts's fallback)
  // every single sweep run indefinitely.
  it("does not mark a portfolio trailing-stale over an instrument it no longer holds", async () => {
    const db = getDb();

    const [u] = await db
      .insert(users)
      .values({ authSub: "exited-instrument-user", email: "exited-instrument@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Exited Position", baseCurrency: "IDR", cashCounted: true })
      .returning();
    const [exited] = await db
      .insert(instruments)
      .values({
        symbol: "EXITED",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Fully Sold Stock",
      })
      .returning();

    const inceptionDate = "2025-06-01";
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: exited.id,
        type: "buy",
        quantity: "10",
        price: "1000",
        currency: "IDR",
        executedAt: new Date(`${inceptionDate}T10:00:00.000Z`),
      },
      {
        portfolioId: pf.id,
        instrumentId: exited.id,
        type: "sell",
        quantity: "10",
        price: "1100",
        currency: "IDR",
        executedAt: new Date("2025-06-15T10:00:00.000Z"),
      },
    ]);

    // A snapshot at inception — fully healed by the earliest-snapshot check alone.
    await db.insert(portfolioSnapshots).values({
      portfolioId: pf.id,
      date: inceptionDate,
      netWorth: "10000",
      marketValue: "0",
      effectiveFlow: "10000",
      currency: "IDR",
    });

    // The exited instrument's last price is far in the past — this would have falsely
    // marked the portfolio trailing-stale under the old "ever transacted" definition.
    const staleDate = toDateKey(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    await db.insert(prices).values({
      instrumentId: exited.id,
      date: staleDate,
      close: "1100",
      currency: "IDR",
    });

    const result = await backfillStalePortfolios(db, svc, 10_000);

    expect(result.portfolios.find((p) => p.portfolioId === pf.id)).toBeUndefined();
  });
});
