import { describe, it, expect } from "vitest";
import { summarizeGoldPlan, type GoldPlanLoan } from "../src/gold.js";
import type { CoreTransaction } from "../src/types.js";

const SCHEDULE = [1, 2, 3, 4].map((n) => ({
  n,
  dueDate: `2026-0${n}-13`,
  pokok: "1000",
  sewaModal: "100",
  angsuran: "1100",
  sisaPokok: String(4000 - n * 1000),
}));

const LOAN: GoldPlanLoan = {
  id: "loan-1",
  instrumentId: "inst-1",
  provider: "GALERI24",
  contractNo: "C-1",
  currency: "IDR",
  purchasePrice: "5000",
  downPayment: "1000",
  principal: "4000",
  marginTotal: "400",
  tenorMonths: 4,
  monthlyInstallment: "1100",
  startDate: "2025-12-13",
  schedule: SCHEDULE,
};

function tx(partial: Partial<CoreTransaction> & Pick<CoreTransaction, "type">): CoreTransaction {
  return {
    instrumentId: null,
    quantity: "0",
    price: "0",
    fees: "0",
    currency: "IDR",
    executedAt: new Date("2025-12-13T00:00:00.000Z"),
    loanId: "loan-1",
    ...partial,
  };
}

const BASE: CoreTransaction[] = [
  tx({ type: "buy", instrumentId: "inst-1", quantity: "5", price: "1000" }),
  tx({ type: "loan_drawdown", price: "4000" }),
];
const repay = (date: string): CoreTransaction =>
  tx({
    type: "loan_repayment",
    price: "1000",
    fees: "100",
    executedAt: new Date(`${date}T00:00:00Z`),
  });

describe("summarizeGoldPlan", () => {
  it("reports a fresh plan: nothing paid, first installment next", () => {
    const s = summarizeGoldPlan(LOAN, BASE, "2025-12-20");
    expect(s).toMatchObject({
      grams: "5",
      paidCount: 0,
      remainingCount: 4,
      paidPrincipal: "0",
      paidMargin: "0",
      outstandingPrincipal: "4000",
      completed: false,
      nextDue: { n: 1, dueDate: "2026-01-13", amount: "1100", overdue: false },
    });
    expect(s.schedule.every((r) => !r.paid && !r.overdue)).toBe(true);
  });

  it("counts booked repayments as the earliest installments and sums principal and margin separately", () => {
    const s = summarizeGoldPlan(
      LOAN,
      [...BASE, repay("2026-01-13"), repay("2026-02-13")],
      "2026-02-20",
    );
    expect(s.paidCount).toBe(2);
    expect(s.remainingCount).toBe(2);
    expect(s.paidPrincipal).toBe("2000");
    expect(s.paidMargin).toBe("200");
    expect(s.outstandingPrincipal).toBe("2000");
    expect(s.schedule.map((r) => r.paid)).toEqual([true, true, false, false]);
    expect(s.nextDue).toEqual({ n: 3, dueDate: "2026-03-13", amount: "1100", overdue: false });
  });

  it("counts a repayment recorded on a different day than its due date", () => {
    // Installment 1 was due Jan 13 but the user recorded the payment on Jan 16.
    const s = summarizeGoldPlan(LOAN, [...BASE, repay("2026-01-16")], "2026-02-01");
    expect(s.paidCount).toBe(1);
    expect(s.schedule.map((r) => r.paid)).toEqual([true, false, false, false]);
    expect(s.nextDue?.n).toBe(2);
  });

  it("flags an unpaid past-due installment as overdue and keeps it as the next due", () => {
    const s = summarizeGoldPlan(LOAN, [...BASE, repay("2026-01-13")], "2026-03-20");
    expect(s.nextDue).toEqual({ n: 2, dueDate: "2026-02-13", amount: "1100", overdue: true });
    expect(s.schedule.map((r) => r.overdue)).toEqual([false, true, true, false]);
  });

  it("completes when every installment is paid", () => {
    const all = ["2026-01-13", "2026-02-13", "2026-03-13", "2026-04-13"].map(repay);
    const s = summarizeGoldPlan(LOAN, [...BASE, ...all], "2026-05-01");
    expect(s.completed).toBe(true);
    expect(s.nextDue).toBeNull();
    expect(s.outstandingPrincipal).toBe("0");
    expect(s.remainingCount).toBe(0);
  });

  it("ignores other loans' legs and tolerates a missing or malformed schedule", () => {
    const other = tx({ type: "loan_repayment", price: "999", loanId: "loan-2" });
    const noSchedule = summarizeGoldPlan(
      { ...LOAN, schedule: [{ n: "x" }, null, 5] },
      [...BASE, repay("2026-01-13"), other],
      "2026-02-01",
    );
    expect(noSchedule.schedule).toEqual([]);
    expect(noSchedule.paidCount).toBe(1);
    expect(noSchedule.nextDue).toBeNull();
    expect(noSchedule.completed).toBe(false);
    expect(noSchedule.outstandingPrincipal).toBe("3000");
  });

  it("derives the installment total when the schedule omits it", () => {
    const s = summarizeGoldPlan(
      { ...LOAN, schedule: [{ n: 1, dueDate: "2026-01-13", pokok: "1000", sewaModal: "100" }] },
      BASE,
      "2026-01-01",
    );
    expect(s.nextDue?.amount).toBe("1100");
  });
});
