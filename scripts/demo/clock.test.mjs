import { describe, expect, it } from "vitest";
import { frozenDate, parseDemoNow } from "./clock.mjs";

describe("parseDemoNow", () => {
  it("is null when unset or empty", () => {
    expect(parseDemoNow(undefined)).toBeNull();
    expect(parseDemoNow("")).toBeNull();
  });

  it("parses an ISO instant with a zone", () => {
    expect(parseDemoNow("2026-10-15T10:00:00Z")).toBe(Date.UTC(2026, 9, 15, 10));
    expect(parseDemoNow("2026-10-15T12:00:00+02:00")).toBe(Date.UTC(2026, 9, 15, 10));
    expect(parseDemoNow("2026-10-15T10:00Z")).toBe(Date.UTC(2026, 9, 15, 10));
  });

  it.each([
    "yesterday",
    "2026-10-15",
    "2026-10-15T10:00:00",
    "2026-13-45T10:00:00Z",
    "1760522400000",
  ])("rejects %s", (value) =>
    expect(() => parseDemoNow(value)).toThrow(/DEMO_NOW must be an ISO instant/),
  );
});

describe("frozenDate", () => {
  const anchor = Date.UTC(2026, 9, 15, 10);
  const base = Date.now() - 60_000; // the demo started a minute ago
  const FakeDate = frozenDate(Date, anchor, base);

  it("starts at the anchor plus the time elapsed since the base", () => {
    const elapsed = Date.now() - base;
    const now = FakeDate.now();
    expect(now - anchor).toBeGreaterThanOrEqual(elapsed);
    expect(now - anchor).toBeLessThan(elapsed + 1_000);
    expect(Math.abs(new FakeDate().getTime() - now)).toBeLessThan(1_000);
  });

  it("ticks", async () => {
    const a = FakeDate.now();
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeDate.now()).toBeGreaterThan(a);
  });

  it("leaves explicit dates, parsing, UTC and instanceof alone", () => {
    expect(new FakeDate(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(new FakeDate("2020-02-29T00:00:00Z").getTime()).toBe(Date.UTC(2020, 1, 29));
    expect(FakeDate.parse("2020-01-01T00:00:00Z")).toBe(Date.UTC(2020, 0, 1));
    expect(FakeDate.UTC(2020, 0, 1)).toBe(Date.UTC(2020, 0, 1));
    expect(new FakeDate() instanceof Date).toBe(true);
    expect(new Date(5) instanceof FakeDate).toBe(true);
  });

  it("still answers Date() called as a function", () => {
    expect(FakeDate()).toContain("2026");
  });
});
