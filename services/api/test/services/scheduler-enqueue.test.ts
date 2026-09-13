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
import { triggerJob, setActiveBoss } from "../../src/services/scheduler/enqueue.js";
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
