/**
 * `triggerJob`'s pg-boss singleton key must be scoped to the payload, not just the job
 * name — otherwise a "force" trigger silently collides with (and no-ops behind) a plain
 * trigger of the same job fired moments earlier, or vice versa, while still reporting
 * `queued: true` to the caller (which then writes a misleading "triggered" audit log
 * entry for a request that did nothing). A `FakeBoss` reproduces pg-boss's own
 * `send()` → `null` on a singleton-key collision so this is testable without a real
 * pg-boss/Postgres instance.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  triggerJob,
  enqueueBackfillInstrument,
  setActiveBoss,
} from "../../src/services/scheduler/enqueue.js";
import type { PgBoss } from "pg-boss";

class FakeBoss {
  private readonly activeSingletonKeys = new Set<string>();

  async send(
    _name: string,
    _data: unknown,
    opts: { singletonKey?: string },
  ): Promise<string | null> {
    const key = opts.singletonKey;
    if (key !== undefined && this.activeSingletonKeys.has(key)) return null;
    if (key !== undefined) this.activeSingletonKeys.add(key);
    return "fake-job-id";
  }
}

/** Records every `send()` call's full arguments (name/data/opts) instead of just
 * simulating singleton-key collision, so a test can assert on the exact payload and
 * options `enqueueBackfillInstrument` sends. `nextResult` lets a test force a `null`
 * (singleton collision) or a throw on the next call. */
class RecordingBoss {
  calls: { name: string; data: unknown; opts: Record<string, unknown> }[] = [];
  nextResult: string | null | "throw" = "fake-job-id";

  async send(
    name: string,
    data: unknown,
    opts: Record<string, unknown> = {},
  ): Promise<string | null> {
    this.calls.push({ name, data, opts });
    if (this.nextResult === "throw") throw new Error("boom");
    return this.nextResult;
  }
}

describe("triggerJob", () => {
  afterEach(() => {
    setActiveBoss(null);
  });

  it("reports alreadyInFlight instead of a false queued:true on a singleton-key collision", async () => {
    const boss = new FakeBoss();
    setActiveBoss(boss as unknown as PgBoss);

    const first = await triggerJob("refresh-prices", {});
    expect(first).toEqual({ queued: true });

    const second = await triggerJob("refresh-prices", {});
    expect(second).toEqual({ queued: false, alreadyInFlight: true });
  });

  it("does not collide a force trigger with a plain trigger of the same job", async () => {
    const boss = new FakeBoss();
    setActiveBoss(boss as unknown as PgBoss);

    const plain = await triggerJob("backfill-stale-history", {});
    expect(plain).toEqual({ queued: true });

    // A force trigger fired moments later must succeed, not silently no-op behind the
    // plain trigger's still-active singleton window (issue found in PR #746 review).
    const forced = await triggerJob("backfill-stale-history", { force: true });
    expect(forced).toEqual({ queued: true });
  });

  it("still collides two identical force triggers within the window", async () => {
    const boss = new FakeBoss();
    setActiveBoss(boss as unknown as PgBoss);

    const first = await triggerJob("backfill-stale-history", { force: true, userId: "u1" });
    expect(first).toEqual({ queued: true });

    const second = await triggerJob("backfill-stale-history", { force: true, userId: "u1" });
    expect(second).toEqual({ queued: false, alreadyInFlight: true });
  });

  it("returns queued:false without alreadyInFlight when the scheduler is unavailable", async () => {
    setActiveBoss(null);
    const result = await triggerJob("refresh-prices", {});
    expect(result).toEqual({ queued: false });
  });
});

describe("enqueueBackfillInstrument (#773)", () => {
  afterEach(() => {
    setActiveBoss(null);
  });

  const sub = {
    backfillJobId: "job-1",
    portfolioId: "pf-1",
    instrumentId: "instr-1",
    chunkStart: "2026-01-01",
    chunkEnd: "2026-02-01",
    tailOnly: true,
  };

  it("returns false with no active boss", async () => {
    setActiveBoss(null);
    const result = await enqueueBackfillInstrument(sub);
    expect(result).toBe(false);
  });

  it("sends the full payload including tailOnly, keyed by backfillJobId with no singletonSeconds throttle", async () => {
    const boss = new RecordingBoss();
    setActiveBoss(boss as unknown as PgBoss);

    const result = await enqueueBackfillInstrument(sub);

    expect(result).toBe(true);
    expect(boss.calls).toHaveLength(1);
    const call = boss.calls[0]!;
    expect(call.name).toBe("backfill-instrument");
    expect(call.data).toEqual({
      backfillJobId: "job-1",
      portfolioId: "pf-1",
      instrumentId: "instr-1",
      chunkStart: "2026-01-01",
      chunkEnd: "2026-02-01",
      tailOnly: true,
    });
    expect(call.opts.singletonKey).toBe("job-1");
    // No singletonSeconds: planFanOut's idempotent upsert can legitimately reuse the
    // same backfillJobId across a pg-boss retry of the portfolio job, and a throttle
    // here would make that legitimate retry's re-send return null and silently never
    // enqueue — see the doc comment on enqueueBackfillInstrument in enqueue.ts.
    expect(call.opts.singletonSeconds).toBeUndefined();
  });

  it("returns false when send throws", async () => {
    const boss = new RecordingBoss();
    boss.nextResult = "throw";
    setActiveBoss(boss as unknown as PgBoss);

    const result = await enqueueBackfillInstrument(sub);
    expect(result).toBe(false);
  });

  it("returns false when send resolves null (singleton collision)", async () => {
    const boss = new RecordingBoss();
    boss.nextResult = null;
    setActiveBoss(boss as unknown as PgBoss);

    const result = await enqueueBackfillInstrument(sub);
    expect(result).toBe(false);
  });
});
