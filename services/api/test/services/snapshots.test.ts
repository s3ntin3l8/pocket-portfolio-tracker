import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  instruments,
  portfolioIntradaySnapshots,
  portfolios,
  portfolioSnapshots,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import { toDateKey, aggregateValueFlows, chainIndex } from "@portfolio/core";
import { MarketDataService, FixtureProvider } from "@portfolio/market-data";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import {
  recordDailySnapshots,
  recordIntradaySnapshots,
  rangeStart,
  aggregateByDate,
} from "../../src/services/snapshots.js";

describe("recordDailySnapshots", () => {
  let portfolioId: string;

  beforeAll(async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "snap-user", email: "snap@example.com" })
      .returning();
    const [p] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Snap", baseCurrency: "IDR", cashCounted: true })
      .returning();
    portfolioId = p.id;
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
    // Deposit 2,000,000, buy 100 @ 9,000 → cash 1,100,000 + 100×9,500 (fixture price).
    await db.insert(transactions).values([
      {
        portfolioId,
        type: "deposit",
        price: "2000000",
        currency: "IDR",
        executedAt: new Date("2026-01-01"),
      },
      {
        portfolioId,
        instrumentId: bbca.id,
        type: "buy",
        quantity: "100",
        price: "9000",
        currency: "IDR",
        executedAt: new Date("2026-01-02"),
      },
    ]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("writes one net-worth snapshot per portfolio, idempotent per day", async () => {
    const db = getDb();
    const svc = new MarketDataService([new FixtureProvider({ BBCA: "9500" })]);
    const now = new Date("2026-02-08T16:00:00.000Z");

    const count = await recordDailySnapshots(db, svc, 10_000, now);
    expect(count).toBe(1);

    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, portfolioId));
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-02-08");
    expect(rows[0].netWorth).toBe("2050000"); // 1,100,000 cash + 100×9,500

    // Re-running the same day overwrites rather than appends.
    await recordDailySnapshots(db, svc, 10_000, now);
    const again = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, portfolioId));
    expect(again).toHaveLength(1);
  });

  it("carries forward last-known close for an unpriced held instrument (≤7d stale)", async () => {
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "carry-user", email: "carry@example.com" })
      .returning();
    const [p] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Carry", baseCurrency: "IDR", cashCounted: true })
      .returning();
    const [instA] = await db
      .insert(instruments)
      .values({
        symbol: "INSTA",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Inst A (priced)",
      })
      .returning();
    const [instB] = await db
      .insert(instruments)
      .values({
        symbol: "INSTB",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Inst B (historical only)",
      })
      .returning();

    // Both held, same quantity × price.
    await db.insert(transactions).values([
      {
        portfolioId: p.id,
        instrumentId: instA.id,
        type: "buy",
        quantity: "10",
        price: "1000",
        currency: "IDR",
        executedAt: new Date("2026-01-10"),
      },
      {
        portfolioId: p.id,
        instrumentId: instB.id,
        type: "buy",
        quantity: "10",
        price: "2000",
        currency: "IDR",
        executedAt: new Date("2026-01-10"),
      },
    ]);

    // Seed historical price for B (2 days ago = ≤7d cap).
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    await db.insert(prices).values({
      instrumentId: instB.id,
      date: toDateKey(twoDaysAgo),
      close: "2500",
      currency: "IDR",
    });

    // FixtureProvider only returns a quote for A, not B.
    const svc = new MarketDataService([new FixtureProvider({ INSTA: "1100" })]);
    const now = new Date();

    const count = await recordDailySnapshots(db, svc, 10_000, now);
    expect(count).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, p.id));
    expect(rows).toHaveLength(1);
    // MV: 10×1100 (A) + 10×2500 (B carried) = 36,000. No cash tracked (no deposit).
    expect(rows[0].marketValue).toBe("36000");
    // Net worth same as MV (no cash).
    expect(rows[0].netWorth).toBe("36000");
  });

  it("leaves a held instrument unpriced when last close is older than 7 days", async () => {
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "stale-user", email: "stale@example.com" })
      .returning();
    const [p] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Stale", baseCurrency: "IDR", cashCounted: true })
      .returning();
    const [instA] = await db
      .insert(instruments)
      .values({
        symbol: "FRESHA",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Fresh A (priced)",
      })
      .returning();
    const [instB] = await db
      .insert(instruments)
      .values({
        symbol: "STALEB",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Stale B (old price)",
      })
      .returning();

    await db.insert(transactions).values([
      {
        portfolioId: p.id,
        instrumentId: instA.id,
        type: "buy",
        quantity: "10",
        price: "1000",
        currency: "IDR",
        executedAt: new Date("2026-01-10"),
      },
      {
        portfolioId: p.id,
        instrumentId: instB.id,
        type: "buy",
        quantity: "10",
        price: "2000",
        currency: "IDR",
        executedAt: new Date("2026-01-10"),
      },
    ]);

    // Seed historical price for B — 30 days ago (beyond 7-day cap).
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    await db.insert(prices).values({
      instrumentId: instB.id,
      date: toDateKey(thirtyDaysAgo),
      close: "2500",
      currency: "IDR",
    });

    const svc = new MarketDataService([new FixtureProvider({ FRESHA: "1100" })]);
    const now = new Date();

    const count = await recordDailySnapshots(db, svc, 10_000, now);
    expect(count).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, p.id));
    expect(rows).toHaveLength(1);
    // Only A contributes: 10×1100 = 11,000. B is too stale → unpriced.
    expect(rows[0].marketValue).toBe("11000");
  });

  // Regression guard for the "Leona" incident: a portfolio with zero transactions
  // (e.g. its transactions were moved into a different portfolio) must not receive a
  // fake `marketValue: 0` snapshot row every day — that's what turns "history stops"
  // into "history cliffs to zero and keeps writing €0 rows forever".
  it("does not write a snapshot for a portfolio with zero transactions", async () => {
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "empty-portfolio-user", email: "empty-portfolio@example.com" })
      .returning();
    const [empty] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Empty", baseCurrency: "IDR", cashCounted: true })
      .returning();

    const svc = new MarketDataService([new FixtureProvider({ BBCA: "9500" })]);
    const now = new Date("2026-02-08T16:00:00.000Z");

    await recordDailySnapshots(db, svc, 10_000, now);

    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, empty.id));
    expect(rows).toHaveLength(0);
  });

  // Regression guard: a portfolio that HAD real history, then had its transactions
  // removed, must get exactly one terminal marketValue:0 row — not zero rows (which
  // would let aggregateValueFlows carry its stale peak value forward forever, since it
  // relies on an explicit zero to recognize "this leg has ended") and not an
  // ever-growing run of them (which is the exact bug this skip exists to prevent).
  it("writes exactly one terminal zero snapshot when a portfolio's transactions are removed after having real history", async () => {
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "vacated-portfolio-user", email: "vacated-portfolio@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Vacated", baseCurrency: "IDR", cashCounted: true })
      .returning();

    // Real prior history, as if the portfolio had transactions before they were deleted.
    await db.insert(portfolioSnapshots).values({
      portfolioId: pf.id,
      date: "2026-02-06",
      netWorth: "18582",
      marketValue: "18582",
      effectiveFlow: "18582",
      currency: "IDR",
    });

    const svc = new MarketDataService([new FixtureProvider({ BBCA: "9500" })]);

    // Day 1 after the transactions were removed: exactly one terminal zero row.
    await recordDailySnapshots(db, svc, 10_000, new Date("2026-02-07T16:00:00.000Z"));
    let rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    expect(rows).toHaveLength(2);
    const terminal = rows.find((r) => r.date === "2026-02-07");
    expect(terminal).toBeDefined();
    expect(terminal!.marketValue).toBe("0");

    // Day 2 and beyond: no further rows — the zero row already signals termination.
    await recordDailySnapshots(db, svc, 10_000, new Date("2026-02-08T16:00:00.000Z"));
    await recordDailySnapshots(db, svc, 10_000, new Date("2026-02-09T16:00:00.000Z"));
    rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    expect(rows).toHaveLength(2);
  });

  // Regression guard: the terminal-zero-row fix above and `aggregateValueFlows`
  // (packages/core/src/twr.ts) are two separate modules connected only by an implicit
  // contract — an explicit `marketValue: 0` row means "this leg has ended". Each side
  // is unit-tested in isolation; this proves the handoff between them actually holds by
  // running the real writer and feeding its real output through the real aggregator.
  it("hands a vacated portfolio's terminal zero row to aggregateValueFlows/chainIndex as a flow, not a phantom return or a permanent carry-forward", async () => {
    const db = getDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "handoff-user", email: "handoff@example.com" })
      .returning();

    // A live portfolio held flat across the window, so any movement in the aggregate
    // index can only be attributed to the vacated leg.
    const [live] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Live", baseCurrency: "IDR", cashCounted: true })
      .returning();
    const [inst] = await db
      .insert(instruments)
      .values({
        symbol: "HANDOFF",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "Handoff Test Co",
      })
      .returning();
    // Executed well before the test window so it never registers as "today's" flow.
    await db.insert(transactions).values({
      portfolioId: live.id,
      instrumentId: inst.id,
      type: "buy",
      quantity: "100",
      price: "9000",
      currency: "IDR",
      executedAt: new Date("2026-02-20"),
    });

    // The vacated portfolio: pre-seed its one real historical row directly (mirrors the
    // sibling test) — by the time this test runs it already has zero transactions.
    const [vacated] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Vacated Handoff", baseCurrency: "IDR", cashCounted: true })
      .returning();
    await db.insert(portfolioSnapshots).values({
      portfolioId: vacated.id,
      date: "2026-03-01",
      netWorth: "18582",
      marketValue: "18582",
      effectiveFlow: "18582",
      currency: "IDR",
    });
    // Baseline row for `live` on the same date, bypassing the writer, so both legs
    // have a real first point on 2026-03-01 (a leg appearing mid-series would otherwise
    // read as a same-day return relative to a near-empty aggregate — a real but separate
    // effect this test isn't about).
    await db.insert(portfolioSnapshots).values({
      portfolioId: live.id,
      date: "2026-03-01",
      netWorth: "950000",
      marketValue: "950000",
      effectiveFlow: "0",
      currency: "IDR",
    });

    const svc = new MarketDataService([new FixtureProvider({ HANDOFF: "9500" })]);
    // Day of termination for `vacated`, plus two more days to prove the phantom value
    // does not get carried forward indefinitely.
    await recordDailySnapshots(db, svc, 10_000, new Date("2026-03-02T16:00:00.000Z"));
    await recordDailySnapshots(db, svc, 10_000, new Date("2026-03-03T16:00:00.000Z"));
    await recordDailySnapshots(db, svc, 10_000, new Date("2026-03-04T16:00:00.000Z"));

    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(inArray(portfolioSnapshots.portfolioId, [live.id, vacated.id]));

    const byPortfolio = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byPortfolio.get(r.portfolioId) ?? [];
      list.push(r);
      byPortfolio.set(r.portfolioId, list);
    }
    const perPortfolio = [...byPortfolio.values()].map((list) =>
      [...list]
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => ({ date: r.date, marketValue: r.marketValue, effectiveFlow: r.effectiveFlow })),
    );

    const aggregate = aggregateValueFlows(perPortfolio);
    const index = chainIndex(aggregate);
    const aggByDate = new Map(aggregate.map((p) => [p.date, p]));
    const idxByDate = new Map(index.map((p) => [p.date, p]));

    // The termination is booked as a flow — the index must not move on that day, or on
    // any day afterward, purely from the vacated leg disappearing.
    for (const date of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]) {
      expect(Number(idxByDate.get(date)!.pct)).toBeCloseTo(0, 6);
    }
    // Directly proves the termination was booked as an outflow (not merely "not yet
    // observed as a return") — with `live` flat, this is entirely the vacated leg's
    // own prior value being subtracted as a flow on the termination date.
    expect(aggByDate.get("2026-03-02")!.effectiveFlow).toBe("-18582");
    // From the termination day onward, the vacated leg contributes nothing further —
    // its pre-termination peak (18,582) must not be carried into the aggregate forever.
    expect(aggByDate.get("2026-03-02")!.marketValue).toBe("950000");
    expect(aggByDate.get("2026-03-03")!.marketValue).toBe("950000");
    expect(aggByDate.get("2026-03-04")!.marketValue).toBe("950000");
  });
});

describe("recordIntradaySnapshots", () => {
  let portfolioId: string;

  beforeAll(async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "intraday-user", email: "intraday@example.com" })
      .returning();
    const [p] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Intraday", baseCurrency: "IDR", cashCounted: true })
      .returning();
    portfolioId = p.id;
    const [bbca] = await db
      .insert(instruments)
      .values({
        symbol: "INTRA",
        market: "IDX", // IDX regular session: Mon–Fri 02:00–09:00 UTC
        assetClass: "equity",
        currency: "IDR",
        name: "Intraday Test Co",
      })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId,
        instrumentId: bbca.id,
        type: "buy",
        quantity: "100",
        price: "9000",
        currency: "IDR",
        executedAt: new Date("2026-01-02"),
      },
    ]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("captures a point when a held instrument's market is open", async () => {
    const db = getDb();
    const svc = new MarketDataService([new FixtureProvider({ INTRA: "9500" })]);
    // Monday 05:00 UTC — inside the IDX session.
    const now = new Date("2026-02-09T05:00:00.000Z");

    const count = await recordIntradaySnapshots(db, svc, 10_000, now);
    // Other portfolios seeded by earlier describes in this file (also holding IDX
    // instruments) may be captured in the same run, so only assert a lower bound —
    // the specific per-portfolio row assertion below is what actually matters here.
    expect(count).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(portfolioIntradaySnapshots)
      .where(eq(portfolioIntradaySnapshots.portfolioId, portfolioId));
    expect(rows).toHaveLength(1);
    expect(rows[0].netWorth).toBe("950000"); // 100 × 9,500
    expect(rows[0].capturedAt.toISOString()).toBe(now.toISOString());
  });

  it("does not touch the DB when no held market is open", async () => {
    const db = getDb();
    const svc = new MarketDataService([new FixtureProvider({ INTRA: "9500" })]);
    // Same Monday, 12:00 UTC — outside the IDX session.
    const now = new Date("2026-02-09T12:00:00.000Z");

    const before = await db
      .select()
      .from(portfolioIntradaySnapshots)
      .where(eq(portfolioIntradaySnapshots.portfolioId, portfolioId));

    const count = await recordIntradaySnapshots(db, svc, 10_000, now);
    expect(count).toBe(0);

    const after = await db
      .select()
      .from(portfolioIntradaySnapshots)
      .where(eq(portfolioIntradaySnapshots.portfolioId, portfolioId));
    expect(after).toHaveLength(before.length);
  });

  it("appends a new row rather than upserting (many rows/day allowed)", async () => {
    const db = getDb();
    const svc = new MarketDataService([new FixtureProvider({ INTRA: "9600" })]);
    const now = new Date("2026-02-09T05:15:00.000Z");

    await recordIntradaySnapshots(db, svc, 10_000, now);
    const rows = await db
      .select()
      .from(portfolioIntradaySnapshots)
      .where(eq(portfolioIntradaySnapshots.portfolioId, portfolioId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("prunes rows older than the retention window", async () => {
    const db = getDb();
    const svc = new MarketDataService([new FixtureProvider({ INTRA: "9500" })]);
    await db.insert(portfolioIntradaySnapshots).values({
      portfolioId,
      capturedAt: new Date("2026-01-01T05:00:00.000Z"), // well past 8 days before Feb 9
      netWorth: "1",
      marketValue: "1",
      currency: "IDR",
    });

    await recordIntradaySnapshots(db, svc, 10_000, new Date("2026-02-09T05:30:00.000Z"));

    const rows = await db
      .select()
      .from(portfolioIntradaySnapshots)
      .where(eq(portfolioIntradaySnapshots.portfolioId, portfolioId));
    expect(rows.every((r) => r.capturedAt.getTime() > new Date("2026-01-10").getTime())).toBe(true);
  });
});

describe("rangeStart", () => {
  it("computes a lower bound for known ranges, null for all/unknown", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    expect(rangeStart("1m", now)).toBe("2026-05-16");
    expect(rangeStart("1y", now)).toBe("2025-06-15");
    expect(rangeStart("all", now)).toBeNull();
    expect(rangeStart("nope", now)).toBeNull();
  });
});

describe("aggregateByDate", () => {
  it("sums same-date snapshots, FX-converting to the display currency", () => {
    const fxFor = () => (from: string, to: string) =>
      from === "USD" && to === "IDR" ? "16000" : "1";
    const out = aggregateByDate(
      [
        { date: "2026-02-01", netWorth: "1000000", currency: "IDR" },
        { date: "2026-02-01", netWorth: "100", currency: "USD" },
        { date: "2026-02-02", netWorth: "1200000", currency: "IDR" },
      ],
      fxFor,
      "IDR",
    );
    expect(out).toEqual([
      { date: "2026-02-01", netWorth: "2600000" }, // 1,000,000 + 100×16,000
      { date: "2026-02-02", netWorth: "1200000" },
    ]);
  });

  it("converts each date at its own day's rate", () => {
    // USD→IDR weakens 16,000 → 16,500 between the two days.
    const rates: Record<string, string> = {
      "2026-02-01": "16000",
      "2026-02-02": "16500",
    };
    const fxFor = (date: string) => (from: string, to: string) =>
      from === "USD" && to === "IDR" ? rates[date] : "1";
    const out = aggregateByDate(
      [
        { date: "2026-02-01", netWorth: "100", currency: "USD" },
        { date: "2026-02-02", netWorth: "100", currency: "USD" },
      ],
      fxFor,
      "IDR",
    );
    expect(out).toEqual([
      { date: "2026-02-01", netWorth: "1600000" }, // 100 × 16,000
      { date: "2026-02-02", netWorth: "1650000" }, // 100 × 16,500
    ]);
  });
});
