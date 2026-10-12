import { describe, it, expect } from "vitest";
import { createLoginThrottle } from "../../src/routes/auth.js";

describe("createLoginThrottle", () => {
  it("blocks after 5 failures within the window, per email, and expires", () => {
    let t = 1_000_000;
    const throttle = createLoginThrottle(() => t);
    for (let i = 0; i < 5; i++) {
      expect(throttle.retryAfter("a@x.com")).toBe(0);
      throttle.recordFailure("a@x.com");
    }
    expect(throttle.retryAfter("a@x.com")).toBeGreaterThan(0);
    expect(throttle.retryAfter("b@x.com")).toBe(0);
    t += 61_000;
    expect(throttle.retryAfter("a@x.com")).toBe(0);
  });

  it("clears on success", () => {
    const throttle = createLoginThrottle();
    for (let i = 0; i < 5; i++) throttle.recordFailure("a@x.com");
    throttle.clear("a@x.com");
    expect(throttle.retryAfter("a@x.com")).toBe(0);
  });
});
