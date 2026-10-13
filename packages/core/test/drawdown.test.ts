import { describe, it, expect } from "vitest";
import { maxDrawdown, type NetWorthPoint } from "../src/drawdown.js";

function pt(date: string, netWorth: string): NetWorthPoint {
  return { date, netWorth };
}

describe("maxDrawdown", () => {
  it("returns zero values for a single-point series", () => {
    const series = [pt("2026-01-02", "100")];
    const result = maxDrawdown(series);
    expect(result.maxDrawdownPct).toBe("0");
    expect(result.peakDate).toBe("2026-01-02");
    expect(result.troughDate).toBe("2026-01-02");
    expect(result.currentDrawdownPct).toBe("0");
  });

  it("returns 0 drawdown for a strictly rising series", () => {
    const series = [pt("2026-01-01", "100"), pt("2026-01-02", "105"), pt("2026-01-03", "110")];
    const result = maxDrawdown(series);
    expect(result.maxDrawdownPct).toBe("0");
    expect(result.currentDrawdownPct).toBe("0");
  });

  it("computes a simple V-shaped drawdown correctly", () => {
    const series = [
      pt("2026-01-01", "100"),
      pt("2026-01-02", "90"),
      pt("2026-01-03", "80"),
      pt("2026-01-04", "95"),
    ];
    const result = maxDrawdown(series);
    expect(result.maxDrawdownPct).toBe("-0.2");
    expect(result.peakDate).toBe("2026-01-01");
    expect(result.troughDate).toBe("2026-01-03");
    expect(result.currentDrawdownPct).toBe("-0.05");
  });

  it("detects recovery when series returns to peak level", () => {
    const series = [
      pt("2026-01-01", "100"),
      pt("2026-01-02", "75"),
      pt("2026-01-03", "85"),
      pt("2026-01-04", "100"),
      pt("2026-01-05", "110"),
    ];
    const result = maxDrawdown(series);
    expect(result.maxDrawdownPct).toBe("-0.25");
    expect(result.peakDate).toBe("2026-01-01");
    expect(result.troughDate).toBe("2026-01-02");
    expect(result.recoveryDate).toBe("2026-01-04");
    expect(result.recoveryDays).toBe(2);
    expect(result.currentDrawdownPct).toBe("0");
  });

  it("handles a drawdown still in progress (no recovery)", () => {
    const series = [
      pt("2026-01-01", "100"),
      pt("2026-01-02", "95"),
      pt("2026-01-03", "85"),
      pt("2026-01-04", "82"),
    ];
    const result = maxDrawdown(series);
    expect(result.maxDrawdownPct).toBe("-0.18");
    expect(result.troughDate).toBe("2026-01-04");
    expect(result.recoveryDate).toBeUndefined();
    expect(result.recoveryDays).toBeUndefined();
    expect(result.currentDrawdownPct).toBe("-0.18");
  });

  it("picks the worst drawdown when there are multiple declines", () => {
    const series = [
      pt("2026-01-01", "100"),
      pt("2026-01-02", "95"),
      pt("2026-01-03", "110"),
      pt("2026-01-04", "105"),
      pt("2026-01-05", "80"),
    ];
    const result = maxDrawdown(series);
    // worst: 80 from peak 110 = -0.2727...
    expect(result.maxDrawdownPct).toBe("-0.27272727272727272727");
    expect(result.peakDate).toBe("2026-01-03");
    expect(result.troughDate).toBe("2026-01-05");
  });

  it("handles an empty series", () => {
    const result = maxDrawdown([]);
    expect(result.maxDrawdownPct).toBe("0");
    expect(result.peakDate).toBeNull();
    expect(result.troughDate).toBeNull();
  });

  describe("non-positive values (audit B13)", () => {
    const finite = (v: string) => Number.isFinite(Number(v));

    it("an all-zero series yields zeros, never NaN", () => {
      const r = maxDrawdown([pt("2026-01-01", "0"), pt("2026-01-02", "0")]);
      expect(r.maxDrawdownPct).toBe("0");
      expect(r.currentDrawdownPct).toBe("0");
    });

    it("leading zeros are skipped — the peak starts at the first positive value", () => {
      const r = maxDrawdown([
        pt("2026-01-01", "0"),
        pt("2026-01-02", "100"),
        pt("2026-01-03", "80"),
        pt("2026-01-04", "90"),
      ]);
      expect(r.maxDrawdownPct).toBe("-0.2");
      expect(r.peakDate).toBe("2026-01-02");
      expect(r.troughDate).toBe("2026-01-03");
      expect(r.currentDrawdownPct).toBe("-0.1");
    });

    it("a negative first value never produces -Infinity or a sign-flipped ratio", () => {
      const r = maxDrawdown([
        pt("2026-01-01", "-50"),
        pt("2026-01-02", "-10"),
        pt("2026-01-03", "0"),
      ]);
      expect(r.maxDrawdownPct).toBe("0");
      expect(r.currentDrawdownPct).toBe("0");
      expect(finite(r.maxDrawdownPct) && finite(r.currentDrawdownPct)).toBe(true);
    });

    it("a zero point after a positive peak is a finite -100% drawdown", () => {
      const r = maxDrawdown([pt("2026-01-01", "100"), pt("2026-01-02", "0")]);
      expect(r.maxDrawdownPct).toBe("-1");
      expect(r.currentDrawdownPct).toBe("-1");
    });
  });
});
