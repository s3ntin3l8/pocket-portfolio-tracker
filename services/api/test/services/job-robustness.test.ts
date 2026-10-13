import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { instruments, portfolios, portfolioSnapshots, transactions, users } from "@portfolio/db";
import { MarketDataService, FixtureProvider } from "@portfolio/market-data";
import type { PgBoss } from "pg-boss";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { recordDailySnapshots } from "../../src/services/snapshots.js";
import { runRecomputeJobs } from "../../src/services/scheduler/recompute.js";
import { withPortfolioLock } from "../../src/services/scheduler/portfolio-lock.js";
import { enqueueRecompute, setActiveBoss } from "../../src/services/scheduler/enqueue.js";

describe("recordDailySnapshots per-portfolio isolation (audit D8)", () => {
  let badId: string;
  let goodId: string;

  beforeAll(async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "jr-user", email: "jr@example.com" })
      .returning();
    // Created first so it is iterated first: its failure must not skip the good one.
    const [bad] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Bad", baseCurrency: "IDR", cashCounted: true })
      .returning();
    const [good] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Good", baseCurrency: "IDR", cashCounted: true })
      .returning();
    badId = bad.id;
    goodId = good.id;
    const [inst] = await db
      .insert(instruments)
      .values({ symbol: "JR1", market: "IDX", assetClass: "equity", currency: "IDR", name: "JR" })
      .returning();
    const buy = (portfolioId: string, currency: string, day: number) => ({
      portfolioId,
      instrumentId: inst.id,
      type: "buy" as const,
      quantity: "1",
      price: "100",
      currency,
      executedAt: new Date(Date.UTC(2026, 0, day)),
    });
    // Mixed-currency cost basis makes computeHoldings throw for the bad portfolio only.
    await db
      .insert(transactions)
      .values([buy(bad.id, "IDR", 1), buy(bad.id, "USD", 2), buy(good.id, "IDR", 1)]);
  });

  afterAll(async () => {
    await closeDb();
  });

  it("one portfolio throwing does not skip the rest", async () => {
    const db = getDb();
    const error = vi.fn();
    const log = { error, warn: vi.fn(), info: vi.fn() } as never;
    const svc = new MarketDataService([new FixtureProvider({ JR1: "100" })]);
    const count = await recordDailySnapshots(
      db,
      svc,
      10_000,
      new Date("2026-02-08T16:00:00.000Z"),
      log,
    );
    expect(count).toBe(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: badId }),
      expect.stringContaining("failed"),
    );
    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, goodId));
    expect(rows).toHaveLength(1);
  });
});

describe("runRecomputeJobs (audit D8)", () => {
  it("attempts every job, then rethrows so pg-boss retries", async () => {
    const calls: string[] = [];
    const onError = vi.fn();
    await expect(
      runRecomputeJobs(
        [
          { data: { portfolioId: "a", fromDate: "2026-01-01" } },
          { data: { portfolioId: "b", fromDate: "2026-01-02" } },
        ],
        {
          recompute: async (id) => {
            calls.push(id);
            if (id === "a") throw new Error("transient");
          },
          onError,
        },
      ),
    ).rejects.toThrow("transient");
    expect(calls).toEqual(["a", "b"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("resolves when all jobs succeed", async () => {
    await expect(
      runRecomputeJobs([{ data: { portfolioId: "a", fromDate: "2026-01-01" } }], {
        recompute: async () => "ok",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("withPortfolioLock (audit D8)", () => {
  it("serializes work for one portfolio, runs different portfolios concurrently", async () => {
    const order: string[] = [];
    const task = (label: string) => async () => {
      order.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${label}:end`);
    };
    await Promise.all([
      withPortfolioLock("p1", task("recompute")),
      withPortfolioLock("p1", task("backfill")),
      withPortfolioLock("p2", task("other")),
    ]);
    expect(order.indexOf("recompute:end")).toBeLessThan(order.indexOf("backfill:start"));
    expect(order.indexOf("other:start")).toBeLessThan(order.indexOf("recompute:end"));
  });

  it("a failing task does not wedge the queue", async () => {
    await expect(
      withPortfolioLock("p3", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    await expect(withPortfolioLock("p3", async () => 7)).resolves.toBe(7);
  });
});

describe("enqueueRecompute singleton drop (audit D8)", () => {
  afterEach(() => setActiveBoss(null));

  it("enqueues a delayed follow-up carrying its own fromDate when the throttle drops the send", async () => {
    const calls: { data: unknown; opts: Record<string, unknown> }[] = [];
    let first = true;
    setActiveBoss({
      send: async (_n: string, data: unknown, opts: Record<string, unknown>) => {
        calls.push({ data, opts });
        if (first) {
          first = false;
          return null; // pg-boss: same singleton slot -> ON CONFLICT DO NOTHING
        }
        return "id";
      },
    } as unknown as PgBoss);
    await enqueueRecompute("pf", "2026-01-01");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.data).toEqual({ portfolioId: "pf", fromDate: "2026-01-01" });
    expect(calls[1]!.opts.startAfter).toBeGreaterThan(0);
  });

  it("sends once when the first send is accepted", async () => {
    const send = vi.fn(async () => "id");
    setActiveBoss({ send } as unknown as PgBoss);
    await enqueueRecompute("pf", "2026-01-01");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
