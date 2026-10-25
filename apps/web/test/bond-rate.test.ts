import { describe, it, expect } from "vitest";
import {
  EMPTY_RATE_SCHEDULE_DRAFT,
  checkRateScheduleDraft,
  effectiveRateForDate,
  rateScheduleToDraft,
  validateRateScheduleDraft,
  type RateScheduleDraft,
} from "../src/lib/bond-rate";

const SCHEDULE = {
  floorRate: "0.0675",
  periods: [
    { from: "2026-01-10", to: "2026-04-10", rate: "0.0675" },
    { from: "2026-04-10", rate: "0.07" },
  ],
};

function draft(over: Partial<RateScheduleDraft> = {}): RateScheduleDraft {
  return {
    floorRatePercent: "6.75",
    periods: [{ from: "2026-01-10", to: "2026-04-10", ratePercent: "6.75" }],
    ...over,
  };
}

describe("rateScheduleToDraft", () => {
  it("turns a stored schedule into percent-in rows", () => {
    expect(rateScheduleToDraft(SCHEDULE)).toEqual({
      floorRatePercent: "6.75",
      periods: [
        { from: "2026-01-10", to: "2026-04-10", ratePercent: "6.75" },
        { from: "2026-04-10", to: "", ratePercent: "7" },
      ],
    });
  });

  it("turns a missing schedule into an empty draft", () => {
    expect(rateScheduleToDraft(null)).toEqual(EMPTY_RATE_SCHEDULE_DRAFT);
    expect(rateScheduleToDraft(undefined)).toEqual(EMPTY_RATE_SCHEDULE_DRAFT);
  });
});

describe("validateRateScheduleDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateRateScheduleDraft(draft())).toBeNull();
  });

  it("reports a missing or malformed floor rate", () => {
    expect(validateRateScheduleDraft(draft({ floorRatePercent: "" }))).toBe("floorMissing");
    expect(validateRateScheduleDraft(draft({ floorRatePercent: "abc" }))).toBe("floorMissing");
  });

  it("reports an empty period list", () => {
    expect(validateRateScheduleDraft(draft({ periods: [] }))).toBe("noPeriods");
  });

  it("reports an incomplete period", () => {
    expect(
      validateRateScheduleDraft(draft({ periods: [{ from: "", to: "", ratePercent: "6.75" }] })),
    ).toBe("periodIncomplete");
    expect(
      validateRateScheduleDraft(
        draft({ periods: [{ from: "2026-01-10", to: "", ratePercent: "" }] }),
      ),
    ).toBe("periodIncomplete");
    // An end date that is not after the start date.
    expect(
      validateRateScheduleDraft(
        draft({ periods: [{ from: "2026-04-10", to: "2026-04-10", ratePercent: "6.75" }] }),
      ),
    ).toBe("periodIncomplete");
  });

  it("reports overlapping periods", () => {
    expect(
      validateRateScheduleDraft(
        draft({
          periods: [
            { from: "2026-01-10", to: "2026-06-10", ratePercent: "6.75" },
            { from: "2026-04-10", to: "", ratePercent: "7" },
          ],
        }),
      ),
    ).toBe("periodOverlaps");
  });

  it("reports an announced rate below the floor", () => {
    // The announced rate is max(reference + spread, floor) — it can never sit below the
    // floor. The API enforces the same rule, but catching it here shows the inline reason
    // instead of a generic error toast.
    expect(
      validateRateScheduleDraft(
        draft({
          floorRatePercent: "8",
          periods: [{ from: "2026-01-10", to: "", ratePercent: "6.75" }],
        }),
      ),
    ).toBe("floorAboveRate");
  });

  it("accepts an announced rate exactly at the floor", () => {
    expect(
      validateRateScheduleDraft(
        draft({
          floorRatePercent: "6.75",
          periods: [{ from: "2026-01-10", to: "", ratePercent: "6.75" }],
        }),
      ),
    ).toBeNull();
  });

  it("does not treat the order the periods were typed in as an error", () => {
    // The payload sorts them by start date, so an out-of-order draft is still valid.
    expect(
      validateRateScheduleDraft(
        draft({
          periods: [
            { from: "2026-04-10", to: "", ratePercent: "7" },
            { from: "2026-01-10", to: "2026-04-10", ratePercent: "6.75" },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("checkRateScheduleDraft", () => {
  it("converts percent-in rows into fraction-out periods", () => {
    const check = checkRateScheduleDraft(draft());
    expect(check.ok).toBe(true);
    expect(check.ok && check.schedule).toEqual({
      floorRate: "0.0675",
      periods: [{ from: "2026-01-10", to: "2026-04-10", rate: "0.0675" }],
    });
  });

  it("drops an empty end date (the period runs to maturity)", () => {
    const check = checkRateScheduleDraft(
      draft({ periods: [{ from: "2026-04-10", to: "", ratePercent: "7" }] }),
    );
    expect(check.ok && check.schedule.periods[0]).toEqual({ from: "2026-04-10", rate: "0.07" });
  });

  it("sorts the periods by start date", () => {
    const check = checkRateScheduleDraft(
      draft({
        periods: [
          { from: "2026-04-10", to: "", ratePercent: "7" },
          { from: "2026-01-10", to: "2026-04-10", ratePercent: "6.75" },
        ],
      }),
    );
    expect(check.ok && check.schedule.periods.map((p) => p.from)).toEqual([
      "2026-01-10",
      "2026-04-10",
    ]);
  });

  it("reports the reason instead of an unusable draft — never a schedule", () => {
    // The result carries the reason, NOT an undefined schedule: a caller can therefore
    // never read an unusable draft as "no schedule" and clear the shared one.
    expect(checkRateScheduleDraft(draft({ floorRatePercent: "" }))).toEqual({
      ok: false,
      issue: "floorMissing",
    });
    expect(checkRateScheduleDraft(draft({ periods: [] }))).toEqual({
      ok: false,
      issue: "noPeriods",
    });
    expect(
      checkRateScheduleDraft(draft({ periods: [{ from: "2026-01-10", to: "", ratePercent: "" }] })),
    ).toEqual({ ok: false, issue: "periodIncomplete" });
    expect(
      checkRateScheduleDraft(
        draft({
          floorRatePercent: "8",
          periods: [{ from: "2026-01-10", to: "", ratePercent: "6.75" }],
        }),
      ),
    ).toEqual({ ok: false, issue: "floorAboveRate" });
  });
});

describe("effectiveRateForDate", () => {
  it("returns the announced rate of the period containing the date", () => {
    expect(effectiveRateForDate(SCHEDULE, "2026-02-01")).toBe("0.0675");
    // `to` is exclusive, so the day it ends belongs to the next period.
    expect(effectiveRateForDate(SCHEDULE, "2026-04-10")).toBe("0.07");
  });

  it("falls back to the floor outside the announced periods", () => {
    expect(effectiveRateForDate(SCHEDULE, "2025-12-31")).toBe("0.0675");
  });

  it("returns null without a schedule", () => {
    expect(effectiveRateForDate(null, "2026-02-01")).toBeNull();
  });
});
