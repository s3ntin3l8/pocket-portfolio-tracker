import { describe, expect, it } from "vitest";
import { createWindowLimiter } from "../src/lib/window-limiter.js";

describe("createWindowLimiter", () => {
  it("allows up to max hits per window and reports when to retry", () => {
    let t = 0;
    const l = createWindowLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect(l.hit("u")).toEqual({ ok: true });
    t = 100;
    expect(l.hit("u")).toEqual({ ok: true });
    t = 200;
    expect(l.hit("u")).toEqual({ ok: false, retryAfterSec: 1 }); // first hit expires at 1000
    expect(l.hit("u").ok).toBe(false); // refused hits are not recorded
    t = 1001;
    expect(l.hit("u")).toEqual({ ok: true }); // the first hit has aged out
  });

  it("a max of 0 refuses everything and waits the whole window", () => {
    const l = createWindowLimiter({ max: 0, windowMs: 5000, now: () => 0 });
    expect(l.hit("u")).toEqual({ ok: false, retryAfterSec: 5 });
  });

  it("counts keys independently", () => {
    const l = createWindowLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(l.hit("a").ok).toBe(true);
    expect(l.hit("b").ok).toBe(true);
    expect(l.hit("a").ok).toBe(false);
  });

  it("slides: only hits inside the window count", () => {
    let t = 0;
    const l = createWindowLimiter({ max: 2, windowMs: 1000, now: () => t });
    l.hit("u"); // t=0
    t = 600;
    l.hit("u"); // t=600
    t = 1100; // the t=0 hit expired, t=600 is still in the window
    expect(l.hit("u").ok).toBe(true);
    expect(l.hit("u").ok).toBe(false);
  });
});
