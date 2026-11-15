import { afterEach, describe, expect, it, vi } from "vitest";
import { haptics } from "../src/lib/haptics";

afterEach(() => {
  // @ts-expect-error test cleanup
  delete navigator.vibrate;
});

describe("haptics", () => {
  it("is a no-op where the Vibration API is missing", () => {
    expect(() => haptics.success()).not.toThrow();
  });

  it("success is a single short tick, distinct from the destructive pattern", () => {
    const vibrate = vi.fn();
    navigator.vibrate = vibrate;
    haptics.success();
    expect(vibrate).toHaveBeenLastCalledWith(10);
    haptics.destructiveConfirm();
    expect(vibrate).toHaveBeenLastCalledWith([20, 40, 20]);
  });

  it("swallows a vibrate() that throws outside a user gesture", () => {
    navigator.vibrate = () => {
      throw new Error("blocked");
    };
    expect(() => haptics.success()).not.toThrow();
  });
});
