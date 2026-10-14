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
  /** `YYYY-MM-DD` of an early payoff (the remaining principal settled in one repayment). */
  closedAt?: string | null;
}

export interface GoldPlanScheduleRow {
  n: number;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  pokok: string;
  sewaModal: string;
  /** Installment total (principal + margin). */
  angsuran: string;
  /** A booked repayment settles this installment (matched by `installmentN`). */
  paid: boolean;
  /** Deliberately skipped: not booked, and its principal stays owed until settled. */
  skipped: boolean;
  /** The loan was paid off early and this installment was never paid on its own. */
  closed: boolean;
  /** Unpaid, not skipped, loan still open, and past its due date. */
  overdue: boolean;
}

export interface GoldPlanSummary {
  loanId: string;
  instrumentId: string;
  provider: string | null;
  contractNo: string | null;
  currency: string;
  /** Grams financed — quantity of the gold purchase leg(s); not reduced by later sells. */
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
  /** `YYYY-MM-DD` the loan was paid off early, or null while it runs to schedule. */
  closedAt: string | null;
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

type ScheduleBase = Omit<GoldPlanScheduleRow, "paid" | "skipped" | "closed" | "overdue"> & {
  /** The row carries the user's `skipped` flag in `loans.schedule`. */
  flaggedSkipped: boolean;
};

function readSchedule(schedule: unknown): ScheduleBase[] {
  if (!Array.isArray(schedule)) return [];
  const rows: ScheduleBase[] = [];
  for (const r of schedule) {
    if (typeof r !== "object" || r === null) continue;
    const { n, dueDate, pokok, sewaModal, angsuran, skipped } = r as Record<string, unknown>;
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
        flaggedSkipped: skipped === true,
      });
    }
  }
  return rows.sort((a, b) => a.n - b.n);
}

/**
 * Progress of one cicilan contract, derived from its schedule and the booked loan legs —
 * never stored. An installment is paid when a booked `loan_repayment` names it
 * (`installmentN`) — an explicit mapping, so an extra or partial manual repayment doesn't
 * shift which installments count as paid. A schedule row the user skipped stays unpaid (its
 * principal remains in the liability net worth subtracts); once the loan was paid off early
 * (`closedAt`), every installment not paid on its own is `closed`. `today` is a `YYYY-MM-DD`
 * date key.
 */
export function summarizeGoldPlan(
  loan: GoldPlanLoan,
  txns: CoreTransaction[],
  today: string,
): GoldPlanSummary {
  const mine = txns.filter((t) => t.loanId === loan.id);
  const repayments = mine.filter((t) => t.type === "loan_repayment");
  const paidNs = new Set(
    repayments.map((t) => t.installmentN).filter((n): n is number => n != null),
  );
  const closedAt = loan.closedAt ?? null;

  const schedule: GoldPlanScheduleRow[] = readSchedule(loan.schedule).map((r) => {
    const { flaggedSkipped, ...row } = r;
    const paid = paidNs.has(r.n);
    const closed = !paid && closedAt !== null;
    const skipped = !paid && !closed && flaggedSkipped;
    return {
      ...row,
      paid,
      skipped,
      closed,
      overdue: !paid && !closed && !skipped && r.dueDate < today,
    };
  });

  const paidCount = schedule.length > 0 ? schedule.filter((r) => r.paid).length : repayments.length;
  // A skipped installment is not "next due" — it waits for the user to un-skip or pay it off.
  const next = schedule.find((r) => !r.paid && !r.closed && !r.skipped) ?? null;
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
    remainingCount: closedAt !== null ? 0 : Math.max(0, loan.tenorMonths - paidCount),
    closedAt,
    paidPrincipal: repayments.reduce((s, t) => s.add(t.price), D(0)).toString(),
    paidMargin: repayments.reduce((s, t) => s.add(t.fees), D(0)).toString(),
    outstandingPrincipal: loanBalances(mine)[loan.id] ?? "0",
    nextDue: next
      ? { n: next.n, dueDate: next.dueDate, amount: next.angsuran, overdue: next.overdue }
      : null,
    schedule,
    // Skipped installments keep the plan open: their principal is still owed.
    completed:
      schedule.length > 0
        ? schedule.every((r) => r.paid || r.closed)
        : paidCount >= loan.tenorMonths,
  };
}
