/**
 * A feed that skipped weeks and then recovered looks healthy to the trailing-staleness
 * check (its NEWEST price is fresh), while the snapshots written during the hole value the
 * holding at 0/cost. The sweep must also look for holes in the MIDDLE of a held
 * instrument's prices, and a fetch that leaves such a hole open must count as a miss so
 * the dead-feed cooldown can stop re-fetching an unfillable gap every night.
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
import {
  backfillPortfolioHistory,
  backfillStalePortfolios,
  fetchInstrumentPrices,
} from "../../src/services/backfill.js";

const DAY = 86_400_000;
/** YYYY-MM-DD for `n` days ago (UTC). */
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const range = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, i) => ago(from - i));

let seq = 0;

/** A fully-backfilled EUR portfolio holding one EUR equity bought `heldDaysAgo` days ago,
 *  with `priceDates` already in `prices`. Everything else is fresh, so only a mid-history
 *  gap can make the sweep pick it up. */
async function seed(opts: {
  priceDates: string[];
  heldDaysAgo?: number;
  missCount?: number;
  errorCount?: number;
  /** A manual-priced bond: never fetched from a provider, one `prices` row per reprice. */
  manualBond?: boolean;
  /** A par bond (face value, no manual price): the backfill writes daily par rows. */
  parBond?: boolean;
}) {
  const db = await ensureDb();
  const tag = `midgap${++seq}`;
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
      assetClass: opts.manualBond || opts.parBond ? "bond" : "equity",
      currency: "EUR",
      name: tag,
      ...(opts.manualBond
        ? { faceValue: "100", manualPrice: "98", manualPriceAt: new Date() }
        : {}),
      ...(opts.parBond ? { faceValue: "100" } : {}),
      priceFeedErrorCount: opts.errorCount ?? 0,
      priceFeedMissCount: opts.missCount ?? 0,
      priceFeedLastMissAt: opts.missCount ? new Date() : null,
    })
    .returning();
  const heldFrom = ago(opts.heldDaysAgo ?? 90);
  await db.insert(transactions).values({
    portfolioId: pf.id,
    instrumentId: instr.id,
    type: "buy",
    quantity: "1",
    price: "10",
    fees: "0",
    currency: "EUR",
    executedAt: new Date(`${heldFrom}T10:00:00.000Z`),
  });
  // Looks fully backfilled from inception.
  await db.insert(portfolioSnapshots).values({
    portfolioId: pf.id,
    date: heldFrom,
    netWorth: "10",
    marketValue: "10",
    effectiveFlow: "0",
    currency: "EUR",
  });
  if (opts.priceDates.length > 0) {
    await db.insert(prices).values(
      opts.priceDates.map((date) => ({
        instrumentId: instr.id,
        date,
        close: "10",
        currency: "EUR",
      })),
    );
  }
  return { db, pf, instr, tag };
}

async function sweep(db: Awaited<ReturnType<typeof ensureDb>>) {
  const calls: { portfolioId: string; fromDate?: string; tailOnly?: boolean }[] = [];
  await backfillStalePortfolios(db, new MarketDataService([]), 10_000, {
    enqueue: async (portfolioId, fromDate, tailOnly) => {
      calls.push({ portfolioId, fromDate, tailOnly });
      return true;
    },
  });
  return calls;
}

describe("backfillStalePortfolios — gaps in the middle of a held instrument's prices", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("enqueues a bounded heal from the first day of the hole, even though the newest price is fresh", async () => {
    // Prices 80..60 days ago, then nothing for 19 days, then 40..0 days ago.
    const { db, pf } = await seed({ priceDates: [...range(80, 60), ...range(40, 0)] });
    const calls = (await sweep(db)).filter((c) => c.portfolioId === pf.id);
    expect(calls).toEqual([{ portfolioId: pf.id, fromDate: ago(59), tailOnly: true }]);
  });

  it("leaves a contiguous series alone", async () => {
    const { db, pf } = await seed({ priceDates: range(80, 0) });
    expect((await sweep(db)).filter((c) => c.portfolioId === pf.id)).toEqual([]);
  });

  it("ignores a hole shorter than the carry-forward window", async () => {
    // A 5-day hole (a long weekend plus a bad day) is bridged by the carry-forward.
    const { db, pf } = await seed({ priceDates: [...range(80, 40), ...range(34, 0)] });
    expect((await sweep(db)).filter((c) => c.portfolioId === pf.id)).toEqual([]);
  });

  it("ignores a hole from before the portfolio first held the instrument", async () => {
    // Held only for the last 20 days; the 19-day hole is 60 days back.
    const { db, pf } = await seed({
      priceDates: [...range(80, 70), ...range(50, 0)],
      heldDaysAgo: 20,
    });
    expect((await sweep(db)).filter((c) => c.portfolioId === pf.id)).toEqual([]);
  });

  it("never enqueues a manual-priced bond: its reprice rows are holes by construction and no fetch ever records a miss", async () => {
    // Repriced 60, 20 and 0 days ago → two interior "holes", newest price fresh.
    const { db, pf } = await seed({ priceDates: [ago(60), ago(20), ago(0)], manualBond: true });
    expect((await sweep(db)).filter((c) => c.portfolioId === pf.id)).toEqual([]);
  });

  it("still heals a par bond's hole: the backfill writes daily par rows, so that heal converges", async () => {
    const { db, pf } = await seed({
      priceDates: [...range(80, 60), ...range(40, 0)],
      parBond: true,
    });
    const calls = (await sweep(db)).filter((c) => c.portfolioId === pf.id);
    expect(calls).toEqual([{ portfolioId: pf.id, fromDate: ago(59), tailOnly: true }]);
  });

  it("does not re-enqueue a manual-priced bond just because its last reprice is old", async () => {
    // Newest row 30 days ago: stale by the trailing check, but no fetch can ever refresh it.
    const { db, pf } = await seed({ priceDates: [ago(60), ago(30)], manualBond: true });
    expect((await sweep(db)).filter((c) => c.portfolioId === pf.id)).toEqual([]);
  });

  it("does not re-enqueue a feed that is cooling down after repeated misses", async () => {
    const { db, pf } = await seed({
      priceDates: [...range(80, 60), ...range(40, 0)],
      missCount: DEAD_FEED_MISS_THRESHOLD,
    });
    expect((await sweep(db)).filter((c) => c.portfolioId === pf.id)).toEqual([]);
  });
});

/** Returns the same candles for every request, filtered to `date >= fromDate`. */
class ListProvider implements MarketDataProvider {
  readonly name = "list";
  constructor(
    private readonly symbol: string,
    private readonly dates: string[],
  ) {}
  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(ref: InstrumentRef, fromDate: string): Promise<Candle[]> {
    if (ref.symbol !== this.symbol) return [];
    return this.dates
      .filter((d) => d >= fromDate)
      .map((date) => ({ date, close: "10", currency: "EUR" }));
  }
}

describe("fetchInstrumentPrices — a fetch that leaves a hole open is a miss", () => {
  async function missCount(db: Awaited<ReturnType<typeof ensureDb>>, id: string) {
    const [row] = await db
      .select({ n: instruments.priceFeedMissCount })
      .from(instruments)
      .where(eq(instruments.id, id));
    return row!.n;
  }

  it("increments the miss counter when the candles leave a hole, without counting an error", async () => {
    const { db, pf, instr, tag } = await seed({ priceDates: [] });
    const svc = new MarketDataService([
      new ListProvider(tag.toUpperCase(), [...range(80, 60), ...range(40, 0)]),
    ]);
    const res = await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(80),
      chunkEnd: ago(0),
    });
    expect(res.unpriced).toBe(false);
    expect(await missCount(db, instr.id)).toBe(1);
    const [row] = await db
      .select({ e: instruments.priceFeedErrorCount })
      .from(instruments)
      .where(eq(instruments.id, instr.id));
    expect(row!.e).toBe(0);
  });

  it("resets the counter on a contiguous series", async () => {
    const { db, pf, instr, tag } = await seed({ priceDates: [], missCount: 3 });
    const svc = new MarketDataService([new ListProvider(tag.toUpperCase(), range(80, 0))]);
    await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(80),
      chunkEnd: ago(0),
    });
    expect(await missCount(db, instr.id)).toBe(0);
  });

  it("uses an already-stored price as the anchor, so a heal returning only the far side of a hole is still a miss", async () => {
    // 60 days ago is stored; the provider returns only the last 40 days → hole 59..41.
    const { db, pf, instr, tag } = await seed({ priceDates: range(80, 60) });
    const svc = new MarketDataService([new ListProvider(tag.toUpperCase(), range(40, 0))]);
    await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(59),
      chunkEnd: ago(0),
      tailOnly: true,
    });
    expect(await missCount(db, instr.id)).toBe(1);
  });

  it("does not count a short fetch against an already-contiguous stored series", async () => {
    // 81 stored daily rows (no hole at all); the provider returns all but 44..31 days ago.
    const { db, pf, instr, tag } = await seed({ priceDates: range(80, 0) });
    const svc = new MarketDataService([
      new ListProvider(tag.toUpperCase(), [...range(80, 45), ...range(30, 0)]),
    ]);
    await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(80),
      chunkEnd: ago(0),
    });
    expect(await missCount(db, instr.id)).toBe(0);
  });

  it("clears a stale error streak on a fetch that returned candles but left a hole", async () => {
    const { db, pf, instr, tag } = await seed({ priceDates: [], errorCount: 3 });
    const svc = new MarketDataService([
      new ListProvider(tag.toUpperCase(), [...range(80, 60), ...range(40, 0)]),
    ]);
    await fetchInstrumentPrices(db, svc, {
      portfolioId: pf.id,
      instrumentId: instr.id,
      chunkStart: ago(80),
      chunkEnd: ago(0),
    });
    const [row] = await db
      .select({ m: instruments.priceFeedMissCount, e: instruments.priceFeedErrorCount })
      .from(instruments)
      .where(eq(instruments.id, instr.id));
    expect(row).toEqual({ m: 1, e: 0 });
  });
});

describe("backfillPortfolioHistory — the inline path grades the series the same way", () => {
  async function missCount(db: Awaited<ReturnType<typeof ensureDb>>, id: string) {
    const [row] = await db
      .select({ n: instruments.priceFeedMissCount })
      .from(instruments)
      .where(eq(instruments.id, id));
    return row!.n;
  }

  it("counts a fetch that leaves a hole as a miss", async () => {
    const { db, pf, instr, tag } = await seed({ priceDates: [] });
    const svc = new MarketDataService([
      new ListProvider(tag.toUpperCase(), [...range(85, 60), ...range(40, 0)]),
    ]);
    await backfillPortfolioHistory(db, svc, 10_000, pf.id);
    expect(await missCount(db, instr.id)).toBe(1);
  });

  it("does not count a short fetch against an already-contiguous stored series", async () => {
    const { db, pf, instr, tag } = await seed({ priceDates: range(85, 0) });
    const svc = new MarketDataService([
      new ListProvider(tag.toUpperCase(), [...range(85, 45), ...range(30, 0)]),
    ]);
    await backfillPortfolioHistory(db, svc, 10_000, pf.id);
    expect(await missCount(db, instr.id)).toBe(0);
  });
});
