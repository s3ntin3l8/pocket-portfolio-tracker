import { describe, it, expect } from "vitest";
import { firstForwardedHop } from "../src/lib/client-ip";

describe("firstForwardedHop", () => {
  it("returns only the first x-forwarded-for hop", () => {
    const h = new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1, 10.0.0.2" });
    expect(firstForwardedHop(h)).toBe("203.0.113.7");
  });
  it("returns null when absent or empty", () => {
    expect(firstForwardedHop(new Headers())).toBeNull();
    expect(firstForwardedHop(new Headers({ "x-forwarded-for": " " }))).toBeNull();
  });
});
