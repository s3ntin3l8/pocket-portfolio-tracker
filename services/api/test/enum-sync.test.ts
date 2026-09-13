import { describe, it, expect } from "vitest";
import { txTypeEnum } from "@portfolio/db";
import { couponScheduleSchema, transactionTypeSchema } from "@portfolio/schema";
import { PERIODS_PER_YEAR } from "@portfolio/core";

// The transaction-type enum is hand-mirrored across three packages (db pgEnum,
// schema zod enum, core TS union). The core union is compile-time enforced; this
// guards the two runtime mirrors from drifting.
describe("transaction-type enum mirrors", () => {
  it("db pgEnum and schema zod enum hold the same set", () => {
    expect([...txTypeEnum.enumValues].sort()).toEqual([...transactionTypeSchema.options].sort());
  });

  it("includes the financing legs", () => {
    expect(txTypeEnum.enumValues).toContain("loan_drawdown");
    expect(txTypeEnum.enumValues).toContain("loan_repayment");
  });
});

// The coupon-schedule set is hand-mirrored between the write-side zod enum
// (couponScheduleSchema, @portfolio/schema) and the read-side lookup table
// (PERIODS_PER_YEAR, @portfolio/core). A drift here is exactly the class of bug that
// let the seed's "semi-annual" (not a PERIODS_PER_YEAR key) silently fall through to
// the `?? 2` default at the right value by luck — this assertion would have caught it.
describe("coupon-schedule enum mirrors", () => {
  it("couponScheduleSchema and PERIODS_PER_YEAR hold the same set", () => {
    expect(Object.keys(PERIODS_PER_YEAR).sort()).toEqual([...couponScheduleSchema.options].sort());
  });
});
