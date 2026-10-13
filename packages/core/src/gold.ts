import { D } from "./decimal.js";
import { loanBalances } from "./loans.js";
import type { CoreTransaction } from "./types.js";

/** A financed gold-purchase (cicilan) contract — the `loans` row fields the report needs. */
export interface GoldPlanLoan {
  id: string;
  instrumentId: string;
  provider: string | null;
  contractNo: string | null;
  currency: string;
  purchasePrice: string;
  downPayment: string;
  principal: string;
  marginTotal: string;
  tenorMonths: number;
  monthlyInstallment: string;
  /** `YYYY-MM-DD`. */
  startDate: string;
  /** `loans.schedule` jsonb — validated row by row, anything malformed is ignored. */
  schedule: unknown;
}

export interface GoldPlanScheduleRow {
  n: number;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  pokok: string;
  sewaModal: string;
  /** Installment total (principal + margin). */
  angsuran: string;
  /** A `loan_repayment` is booked on this due date. */
  paid: boolean;
  /** Unpaid and past its due date. */
  overdue: boolean;
}

export interface GoldPlanSummary {
  loanId: string;
  instrumentId: string;
  provider: string | null;
  contractNo: string | null;
  currency: string;
  /** Grams financed — quantity of the gold purchase leg. */
  grams: string;
  purchasePrice: string;
  downPayment: string;
  principal: string;
  marginTotal: string;
  tenorMonths: number;
  monthlyInstallment: string;
  startDate: string;
  paidCount: number;
  remainingCount: number;
  paidPrincipal: string;
  paidMargin: string;
  /** Σ drawdown − Σ repayment principal (the same derivation as `loanBalances`). */
  outstandingPrincipal: string;
  /** First unpaid installment (overdue ones first), or null when the schedule is complete. */
  nextDue: { n: number; dueDate: string; amount: string; overdue: boolean } | null;
  schedule: GoldPlanScheduleRow[];
  /** Every installment is paid. */
  completed: boolean;
}

function readSchedule(schedule: unknown): Omit<GoldPlanScheduleRow, "paid" | "overdue">[] {
  if (!Array.isArray(schedule)) return [];
  const rows: Omit<GoldPlanScheduleRow, "paid" | "overdue">[] = [];
  for (const r of schedule) {
    if (typeof r !== "object" || r === null) continue;
    const { n, dueDate, pokok, sewaModal, angsuran } = r as Record<string, unknown>;
    if (
      typeof n === "number" &&
      typeof dueDate === "string" &&
      typeof pokok === "string" &&
      typeof sewaModal === "string"
    ) {
      rows.push({
        n,
        dueDate,
        pokok,
        sewaModal,
        angsuran: typeof angsuran === "string" ? angsuran : D(pokok).add(sewaModal).toString(),
      });
    }
  }
  return rows.sort((a, b) => a.n - b.n);
}

/**
 * Progress of one cicilan contract, derived from its schedule and the booked loan legs —
 * never stored. The loan's booked `loan_repayment`s are counted and that many of the earliest
 * installments are shown as paid — the same rule `bookDueInstallments` uses, so a payment the
 * user recorded on a different day than its due date still counts, and the report agrees with
 * the liability that net worth subtracts. `today` is a `YYYY-MM-DD` date key.
 */
export function summarizeGoldPlan(
  loan: GoldPlanLoan,
  txns: CoreTransaction[],
  today: string,
): GoldPlanSummary {
  const mine = txns.filter((t) => t.loanId === loan.id);
  const repayments = mine.filter((t) => t.type === "loan_repayment");

  const schedule: GoldPlanScheduleRow[] = readSchedule(loan.schedule).map((r, i) => {
    const paid = i < repayments.length;
    return { ...r, paid, overdue: !paid && r.dueDate < today };
  });

  const paidCount = schedule.length > 0 ? schedule.filter((r) => r.paid).length : repayments.length;
  const next = schedule.find((r) => !r.paid) ?? null;
  const grams = mine.filter((t) => t.type === "buy").reduce((sum, t) => sum.add(t.quantity), D(0));

  return {
    loanId: loan.id,
    instrumentId: loan.instrumentId,
    provider: loan.provider,
    contractNo: loan.contractNo,
    currency: loan.currency,
    grams: grams.toString(),
    purchasePrice: loan.purchasePrice,
    downPayment: loan.downPayment,
    principal: loan.principal,
    marginTotal: loan.marginTotal,
    tenorMonths: loan.tenorMonths,
    monthlyInstallment: loan.monthlyInstallment,
    startDate: loan.startDate,
    paidCount,
    remainingCount: Math.max(0, loan.tenorMonths - paidCount),
    paidPrincipal: repayments.reduce((s, t) => s.add(t.price), D(0)).toString(),
    paidMargin: repayments.reduce((s, t) => s.add(t.fees), D(0)).toString(),
    outstandingPrincipal: loanBalances(mine)[loan.id] ?? "0",
    nextDue: next
      ? { n: next.n, dueDate: next.dueDate, amount: next.angsuran, overdue: next.overdue }
      : null,
    schedule,
    completed: schedule.length > 0 ? next === null : paidCount >= loan.tenorMonths,
  };
}
