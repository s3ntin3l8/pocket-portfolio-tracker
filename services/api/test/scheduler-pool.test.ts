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
    expect(isPoolConnectionError(null)).toBe(false);
  });
});

describe("createPoolWatchdog", () => {
  const err = new Error("timeout exceeded when trying to connect");
  const min = 60_000;

  it("exits after a continuous 15 min streak", () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({ exit, now: () => t });
    for (; t < 15 * min; t += 10_000) w.onError(err);
    expect(exit).not.toHaveBeenCalled();
    w.onError(err);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("a quiet gap resets the streak", () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({ exit, now: () => t });
    for (; t < 10 * min; t += 10_000) w.onError(err);
    t += 5 * min;
    for (let i = 0; i < 60; i++, t += 10_000) w.onError(err);
    expect(exit).not.toHaveBeenCalled();
  });

  it("ignores unrelated errors", () => {
    let t = 0;
    const exit = vi.fn();
    const w = createPoolWatchdog({ exit, now: () => t });
    for (; t < 30 * min; t += 10_000) w.onError(new Error("handler failed"));
    expect(exit).not.toHaveBeenCalled();
  });
});
