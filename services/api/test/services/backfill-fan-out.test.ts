/**
 * Tests for the backfill fan-out core (`planFanOut`/`pollFanOutCompletion`/`runFanOut`,
 * #773's restructure of the per-instrument sub-job fan-out from #761/#772). This module
 * exists specifically so the planning/enqueue/poll/cleanup logic that used to live
 * inline inside `scheduler.ts`'s `boss.work(...)` callback — and was therefore never
 * exercised by any test — can be driven directly against a real PGlite `DB`, with no
 * pg-boss involved at all (the one pg-boss-touching piece, `enqueueBackfillInstrument`,
 * is tested separately in scheduler-enqueue.test.ts).
 *
 * Coverage:
 * - `planFanOut`: per-instrument chunk boundaries use each instrument's OWN first-held
 *   date; `fromDate` clamps the window; `tailOnly` is threaded into every sub-job;
 *   idempotent over a pre-existing orphan row (the direct regression test for the
 *   duplicate-key bug that used to brick a portfolio's backfill after a crash);
 *   `createdAt` round-trips exactly across every claimed row; orphan rows are GC'd
 *   without touching a concurrent run's fresh rows; a cash-only portfolio plans zero
 *   sub-jobs.
 * - `pollFanOutCompletion`: resolves once all rows are done; a failed row rejects and
 *   cleans up; exceeding the deadline rejects and LEAVES rows intact; an abort signal
 *   rejects promptly (within one poll tick, not the full interval — the direct
 *   regression test for the zombie-poll-loop bug) and leaves rows intact; rows
 *   re-claimed or deleted out from under a poll are a distinct "ownership lost" error,
 *   not a hang.
 * - `runFanOut`: happy path enqueues+polls+cleans; a failing `enqueue` call fails fast
 *   (not after waiting out the deadline) and still cleans up; an empty plan is a no-op.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { backfillJobs, instruments, portfolios, transactions, users } from "@portfolio/db";
import { ensureDb, closeDb } from "../../src/db/client.js";
import {
  planFanOut,
  pollFanOutCompletion,
  runFanOut,
  FanOutEnqueueError,
  FanOutSubJobFailedError,
  FanOutTimeoutError,
  FanOutAbortedError,
  FanOutOwnershipLostError,
  type FanOutPlan,
  type FanOutSubJob,
} from "../../src/services/backfill/fan-out.js";
import type { DB } from "../../src/db/client.js";

let counter = 0;

/** Fresh user + portfolio + one or more instruments, each bought (buy, qty 1, price 50)
 * on its own `firstHeld` date. */
async function makeFixture(
  db: DB,
  opts: { instruments?: { symbol: string; firstHeld: string }[] } = {},
) {
  counter++;
  const [u] = await db
    .insert(users)
    .values({ authSub: `fanout-user-${counter}`, email: `fanout-${counter}@example.com` })
    .returning();
  const [pf] = await db
    .insert(portfolios)
    .values({ userId: u.id, name: `Fan-Out ${counter}`, baseCurrency: "USD", cashCounted: false })
    .returning();

  const specs = opts.instruments ?? [{ symbol: `FO${counter}`, firstHeld: "2026-01-10" }];
  const instrs = [];
  for (const spec of specs) {
    const [instr] = await db
      .insert(instruments)
      .values({
        symbol: spec.symbol,
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: spec.symbol,
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
        executedAt: new Date(`${spec.firstHeld}T10:00:00.000Z`),
      },
    ]);
    instrs.push(instr);
  }
  return { pf, instrs };
}

/** Seeds `n` standalone coordination rows (synthetic instrumentIds, no real instrument
 * needed — `backfill_jobs.instrument_id` has no FK) for testing `pollFanOutCompletion`
 * directly without going through `planFanOut`. */
async function seedSubJobs(
  db: DB,
  portfolioId: string,
  n: number,
  status: string,
  createdAt: Date,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    counter++;
    const [row] = await db
      .insert(backfillJobs)
      .values({
        portfolioId,
        instrumentId: `synthetic-${counter}`,
        chunkStart: "2026-01-01",
        chunkEnd: "2026-02-01",
        status,
        createdAt,
      })
      .returning({ id: backfillJobs.id });
    ids.push(row!.id);
  }
  return ids;
}

describe("planFanOut (#773)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("computes each instrument's own chunk boundary, not the portfolio's earliest", async () => {
    const db = await ensureDb();
    const { pf, instrs } = await makeFixture(db, {
      instruments: [
        { symbol: "FOA", firstHeld: "2026-01-10" },
        { symbol: "FOB", firstHeld: "2026-03-05" },
      ],
    });
    const plan = await planFanOut(db, pf.id);
    expect(plan.subJobs).toHaveLength(2);
    const byInstr = new Map(plan.subJobs.map((s) => [s.instrumentId, s]));
    expect(byInstr.get(instrs[0]!.id)!.chunkStart).toBe("2026-01-10");
    expect(byInstr.get(instrs[1]!.id)!.chunkStart).toBe("2026-03-05");
  });

  it("clamps chunkStart to fromDate when it's later than first-held", async () => {
    const db = await ensureDb();
    const { pf } = await makeFixture(db, {
      instruments: [
        { symbol: "FOC", firstHeld: "2026-01-10" },
        { symbol: "FOD", firstHeld: "2026-03-05" },
      ],
    });
    const plan = await planFanOut(db, pf.id, { fromDate: "2026-04-01" });
    expect(plan.subJobs.every((s) => s.chunkStart === "2026-04-01")).toBe(true);
  });

  it("threads tailOnly into every subJob, defaulting to false when omitted", async () => {
    const db = await ensureDb();
    const { pf: pfTail } = await makeFixture(db);
    const planTrue = await planFanOut(db, pfTail.id, { tailOnly: true });
    expect(planTrue.subJobs.every((s) => s.tailOnly === true)).toBe(true);

    const { pf: pfNoTail } = await makeFixture(db);
    const planFalse = await planFanOut(db, pfNoTail.id);
    expect(planFalse.subJobs.every((s) => s.tailOnly === false)).toBe(true);
  });

  it("is idempotent over a pre-existing orphan row instead of throwing a duplicate-key error", async () => {
    const db = await ensureDb();
    const { pf, instrs } = await makeFixture(db, {
      instruments: [{ symbol: "FOE", firstHeld: "2026-01-10" }],
    });
    const instr = instrs[0]!;
    const oldClaimedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const [orphan] = await db
      .insert(backfillJobs)
      .values({
        portfolioId: pf.id,
        instrumentId: instr.id,
        chunkStart: "2026-01-10",
        chunkEnd: "2026-01-20",
        status: "done",
        createdAt: oldClaimedAt,
      })
      .returning();

    const plan = await planFanOut(db, pf.id);

    expect(plan.subJobs).toHaveLength(1);
    expect(plan.subJobs[0]!.backfillJobId).toBe(orphan!.id);

    const [row] = await db.select().from(backfillJobs).where(eq(backfillJobs.id, orphan!.id));
    expect(row.status).toBe("pending");
    expect(row.chunkEnd).not.toBe("2026-01-20");
    expect(row.createdAt.getTime()).toBe(plan.claimedAt.getTime());
  });

  it("stamps every claimed row with the same claimedAt, round-tripped exactly", async () => {
    const db = await ensureDb();
    const { pf } = await makeFixture(db, {
      instruments: [
        { symbol: "FOF", firstHeld: "2026-01-10" },
        { symbol: "FOG", firstHeld: "2026-02-15" },
      ],
    });
    const plan = await planFanOut(db, pf.id);
    const rows = await db
      .select()
      .from(backfillJobs)
      .where(inArray(backfillJobs.id, plan.subJobIds));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBe(plan.claimedAt.getTime());
    }
  });

  it("reaps old mismatched orphan rows but not a concurrent run's fresh rows", async () => {
    const db = await ensureDb();
    const { pf, instrs } = await makeFixture(db, {
      instruments: [{ symbol: "FOH", firstHeld: "2026-01-10" }],
    });
    const instr = instrs[0]!;

    const [oldOrphan] = await db
      .insert(backfillJobs)
      .values({
        portfolioId: pf.id,
        instrumentId: instr.id,
        chunkStart: "2020-01-01", // stale chunkStart, no longer matches any computed boundary
        chunkEnd: "2020-02-01",
        status: "done",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24h old
      })
      .returning();

    const [freshConcurrent] = await db
      .insert(backfillJobs)
      .values({
        portfolioId: pf.id,
        instrumentId: instr.id,
        chunkStart: "2019-01-01", // also a stale chunkStart, but FRESH createdAt
        chunkEnd: "2019-02-01",
        status: "pending",
        createdAt: new Date(),
      })
      .returning();

    await planFanOut(db, pf.id);

    const oldRow = await db.select().from(backfillJobs).where(eq(backfillJobs.id, oldOrphan!.id));
    expect(oldRow).toHaveLength(0);

    const freshRow = await db
      .select()
      .from(backfillJobs)
      .where(eq(backfillJobs.id, freshConcurrent!.id));
    expect(freshRow).toHaveLength(1);
  });

  it("plans zero sub-jobs for a cash-only portfolio", async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-cash-user", email: "fanout-cash@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Fan-Out Cash", baseCurrency: "USD", cashCounted: true })
      .returning();
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        type: "deposit",
        price: "1000",
        currency: "USD",
        executedAt: new Date("2026-01-01T10:00:00.000Z"),
      },
    ]);

    const plan = await planFanOut(db, pf.id);
    expect(plan.pending).toBe(0);
    expect(plan.subJobs).toEqual([]);
  });
});

describe("pollFanOutCompletion (#773)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("resolves once all rows are already done, and cleans up", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-1", email: "fanout-poll-1@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 1", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 2, "done", claimedAt);

    const result = await pollFanOutCompletion(
      db,
      { subJobIds: ids, claimedAt },
      { pollIntervalMs: 10, maxWaitMs: 2_000 },
    );

    expect(result.done).toBe(2);
    expect(result.cleaned).toBe(true);
    const rows = await db.select().from(backfillJobs).where(inArray(backfillJobs.id, ids));
    expect(rows).toHaveLength(0);
  });

  it("resolves once rows flip to done mid-poll", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-2", email: "fanout-poll-2@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 2", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 2, "pending", claimedAt);

    setTimeout(() => {
      // drizzle query builders are lazy "thenables" — the query is only actually
      // dispatched once `.then()`/`await` is invoked, so a bare `void db.update(...)`
      // with no `.then()` never sends anything. `.then(() => {})` forces dispatch.
      db.update(backfillJobs)
        .set({ status: "done" })
        .where(inArray(backfillJobs.id, ids))
        .then(() => {});
    }, 50);

    const result = await pollFanOutCompletion(
      db,
      { subJobIds: ids, claimedAt },
      { pollIntervalMs: 15, maxWaitMs: 2_000 },
    );
    expect(result.done).toBe(2);
  });

  it("rejects with FanOutSubJobFailedError when a row fails, and cleans up", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-3", email: "fanout-poll-3@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 3", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 2, "pending", claimedAt);
    await db.update(backfillJobs).set({ status: "failed" }).where(eq(backfillJobs.id, ids[0]!));

    await expect(
      pollFanOutCompletion(
        db,
        { subJobIds: ids, claimedAt },
        { pollIntervalMs: 10, maxWaitMs: 2_000 },
      ),
    ).rejects.toThrow(FanOutSubJobFailedError);

    const rows = await db.select().from(backfillJobs).where(inArray(backfillJobs.id, ids));
    expect(rows).toHaveLength(0);
  });

  it("rejects with FanOutTimeoutError when maxWaitMs is exceeded, leaving rows intact", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-4", email: "fanout-poll-4@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 4", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 1, "pending", claimedAt);

    await expect(
      pollFanOutCompletion(
        db,
        { subJobIds: ids, claimedAt },
        { pollIntervalMs: 10, maxWaitMs: 30 },
      ),
    ).rejects.toThrow(FanOutTimeoutError);

    const rows = await db.select().from(backfillJobs).where(inArray(backfillJobs.id, ids));
    expect(rows).toHaveLength(1);
  });

  it("rejects promptly on an abort signal — well under the poll interval — leaving rows intact", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-5", email: "fanout-poll-5@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 5", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 1, "pending", claimedAt);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const start = Date.now();

    await expect(
      pollFanOutCompletion(
        db,
        { subJobIds: ids, claimedAt },
        { pollIntervalMs: 5_000, maxWaitMs: 30_000, signal: controller.signal },
      ),
    ).rejects.toThrow(FanOutAbortedError);

    // The poll interval is 5s; a correct abort-aware wait rejects within ~20ms of the
    // abort firing, not after waiting out the interval.
    expect(Date.now() - start).toBeLessThan(1_000);

    const rows = await db.select().from(backfillJobs).where(inArray(backfillJobs.id, ids));
    expect(rows).toHaveLength(1);
  });

  it("rejects synchronously for an already-aborted signal", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-6", email: "fanout-poll-6@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 6", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 1, "pending", claimedAt);

    const controller = new AbortController();
    controller.abort();
    const start = Date.now();

    await expect(
      pollFanOutCompletion(
        db,
        { subJobIds: ids, claimedAt },
        { pollIntervalMs: 5_000, maxWaitMs: 30_000, signal: controller.signal },
      ),
    ).rejects.toThrow(FanOutAbortedError);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("rejects with FanOutOwnershipLostError when rows are re-claimed by a concurrent replan", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-7", email: "fanout-poll-7@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 7", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 1, "pending", claimedAt);

    setTimeout(() => {
      // See the `.then(() => {})` comment in the "flips to done mid-poll" test above —
      // a bare `void db.update(...)` never dispatches drizzle's lazy query builder.
      db.update(backfillJobs)
        .set({ createdAt: new Date() })
        .where(inArray(backfillJobs.id, ids))
        .then(() => {});
    }, 50);

    await expect(
      pollFanOutCompletion(
        db,
        { subJobIds: ids, claimedAt },
        { pollIntervalMs: 15, maxWaitMs: 2_000 },
      ),
    ).rejects.toThrow(FanOutOwnershipLostError);

    // Distinct from the failed/success verdicts — rows are left alone, not deleted.
    const rows = await db.select().from(backfillJobs).where(inArray(backfillJobs.id, ids));
    expect(rows).toHaveLength(1);
  });

  it("rejects with FanOutOwnershipLostError (not a hang) when a row is deleted underneath the poll", async () => {
    const db = await ensureDb();
    const claimedAt = new Date();
    const [u] = await db
      .insert(users)
      .values({ authSub: "fanout-poll-8", email: "fanout-poll-8@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Poll 8", baseCurrency: "USD" })
      .returning();
    const ids = await seedSubJobs(db, pf.id, 1, "pending", claimedAt);

    setTimeout(() => {
      // See the `.then(() => {})` comment above — a bare `void db.delete(...)` never
      // dispatches drizzle's lazy query builder.
      db.delete(backfillJobs)
        .where(inArray(backfillJobs.id, ids))
        .then(() => {});
    }, 50);

    await expect(
      pollFanOutCompletion(
        db,
        { subJobIds: ids, claimedAt },
        { pollIntervalMs: 15, maxWaitMs: 2_000 },
      ),
    ).rejects.toThrow(FanOutOwnershipLostError);
  });
});

describe("runFanOut (#773)", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("enqueues, polls, and cleans up on the happy path", async () => {
    const db = await ensureDb();
    const { pf } = await makeFixture(db, {
      instruments: [
        { symbol: "FORUN1", firstHeld: "2026-01-10" },
        { symbol: "FORUN2", firstHeld: "2026-02-15" },
      ],
    });
    const plan = await planFanOut(db, pf.id, { tailOnly: true });
    const enqueuedPayloads: FanOutSubJob[] = [];

    const result = await runFanOut(db, plan, {
      enqueue: async (sub) => {
        enqueuedPayloads.push(sub);
        await db
          .update(backfillJobs)
          .set({ status: "done" })
          .where(eq(backfillJobs.id, sub.backfillJobId));
        return true;
      },
      pollIntervalMs: 10,
      maxWaitMs: 2_000,
    });

    expect(result.enqueued).toBe(2);
    expect(result.done).toBe(2);
    expect(result.cleaned).toBe(true);
    expect(enqueuedPayloads).toHaveLength(2);
    expect(enqueuedPayloads.every((p) => p.tailOnly === true)).toBe(true);

    const rows = await db
      .select()
      .from(backfillJobs)
      .where(inArray(backfillJobs.id, plan.subJobIds));
    expect(rows).toHaveLength(0);
  });

  it("fails fast on an enqueue failure without waiting out the deadline, and cleans up", async () => {
    const db = await ensureDb();
    const { pf } = await makeFixture(db, {
      instruments: [
        { symbol: "FOFAIL1", firstHeld: "2026-01-10" },
        { symbol: "FOFAIL2", firstHeld: "2026-02-15" },
      ],
    });
    const plan = await planFanOut(db, pf.id);
    let calls = 0;
    const start = Date.now();

    await expect(
      runFanOut(db, plan, {
        enqueue: async () => {
          calls++;
          return calls < 2; // second call fails
        },
        pollIntervalMs: 5_000,
        maxWaitMs: 60_000,
      }),
    ).rejects.toThrow(FanOutEnqueueError);

    expect(Date.now() - start).toBeLessThan(1_000);

    const rows = await db
      .select()
      .from(backfillJobs)
      .where(inArray(backfillJobs.id, plan.subJobIds));
    expect(rows).toHaveLength(0);
  });

  it("no-ops for an empty plan without calling enqueue", async () => {
    const db = await ensureDb();
    const emptyPlan: FanOutPlan = {
      portfolioId: "00000000-0000-0000-0000-000000000000",
      instruments: 0,
      pending: 0,
      claimedAt: new Date(),
      subJobIds: [],
      subJobs: [],
    };
    let called = false;

    const result = await runFanOut(db, emptyPlan, {
      enqueue: async () => {
        called = true;
        return true;
      },
    });

    expect(called).toBe(false);
    expect(result).toEqual({ enqueued: 0, done: 0, waitedMs: 0, cleaned: false });
  });
});
