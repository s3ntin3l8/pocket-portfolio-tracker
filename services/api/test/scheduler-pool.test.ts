import { describe, expect, it, vi } from "vitest";
import {
  PG_BOSS_POOL_OPTIONS,
  createPoolWatchdog,
  isPoolConnectionError,
} from "../src/services/scheduler/pool.js";

describe("PG_BOSS_POOL_OPTIONS", () => {
  it("keeps the pool capped with keepalive and a query timeout", () => {
    expect(PG_BOSS_POOL_OPTIONS.max).toBe(5);
    expect(PG_BOSS_POOL_OPTIONS.keepAlive).toBe(true);
    expect(PG_BOSS_POOL_OPTIONS.keepAliveInitialDelayMillis).toBeGreaterThan(0);
    expect(PG_BOSS_POOL_OPTIONS.query_timeout).toBeGreaterThan(0);
  });
});

describe("isPoolConnectionError", () => {
  it("matches connection failures only", () => {
    expect(isPoolConnectionError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isPoolConnectionError({ message: "read ECONNRESET" })).toBe(true);
    expect(isPoolConnectionError(new Error("job handler blew up"))).toBe(false);
    expect(isPoolConnectionError(new Error("Query read timeout"))).toBe(true);
    expect(isPoolConnectionError({ code: "57P01", message: "terminating connection" })).toBe(true);
    expect(isPoolConnectionError(null)).toBe(false);
  });
});

describe("createPoolWatchdog", () => {
  const err = new Error("timeout exceeded when trying to connect");
  const min = 60_000;
  const streak = async (
    w: ReturnType<typeof createPoolWatchdog>,
    set: (t: number) => void,
    from: number,
    to: number,
  ) => {
    for (let t = from; t < to; t += 10_000) {
      set(t);
      await w.onError(err);
    }
  };

  it("exits once after a continuous 15 min streak when the probe fails", async () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({ exit, probe: async () => false, now: () => t });
    await streak(w, (x) => (t = x), 0, 15 * min);
    expect(exit).not.toHaveBeenCalled();
    await streak(w, (x) => (t = x), 15 * min, 16 * min);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("does not exit when the pool answers the probe (saturated, not wedged)", async () => {
    let t = 0;
    const exit = vi.fn();
    const probe = vi.fn(async () => true);
    const w = createPoolWatchdog({ exit, probe, now: () => t });
    await streak(w, (x) => (t = x), 0, 20 * min);
    expect(probe).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("treats a rejecting probe as wedged", async () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({
      exit,
      probe: async () => Promise.reject(new Error("x")),
      now: () => t,
    });
    await streak(w, (x) => (t = x), 0, 16 * min);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("a quiet gap resets the streak", async () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({ exit, probe: async () => false, now: () => t });
    await streak(w, (x) => (t = x), 0, 10 * min);
    await streak(w, (x) => (t = x), 15 * min, 20 * min);
    expect(exit).not.toHaveBeenCalled();
  });

  it("ignores unrelated errors", async () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({ exit, probe: async () => false, now: () => t });
    for (; t < 30 * min; t += 10_000) await w.onError(new Error("handler failed"));
    expect(exit).not.toHaveBeenCalled();
  });
});
