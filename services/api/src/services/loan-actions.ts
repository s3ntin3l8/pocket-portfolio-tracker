import { and, eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { loans, transactions } from "@portfolio/db";
import { loanBalances, summarizeGoldPlan, toDateKey } from "@portfolio/core";
import type { DB } from "../db/client.js";
import { toCoreTxns } from "./tx-core.js";
import { bookDueInstallments, asScheduleRows } from "./loan-installments.js";
import { enqueueRecompute } from "./scheduler/enqueue.js";

/** `db` or a transaction handle — only the query builders the actions use. */
type Exec = Pick<DB, "select" | "update" | "insert" | "delete">;
type LoanRow = typeof loans.$inferSelect;

/** A request the user can fix by changing their input; carries the HTTP status to send. */
export class LoanActionError extends Error {
  constructor(
    readonly status: 404 | 409 | 400,
    readonly code: string,
  ) {
    super(code);
  }
}

export const payoffExternalId = (loanId: string) => `loan:${loanId}:payoff`;

/** Rewrite the raw schedule jsonb, flagging (or un-flagging) the given installments. */
function withSkipped(schedule: unknown, ns: Set<number>, skipped: boolean): unknown {
  if (!Array.isArray(schedule) || ns.size === 0) return schedule;
  return schedule.map((r) => {
    if (typeof r !== "object" || r === null || !ns.has((r as { n: number }).n)) return r;
    const { skipped: _drop, ...rest } = r as Record<string, unknown>;
    return skipped ? { ...rest, skipped: true } : rest;
  });
}

/**
 * Load a loan, scoped to its portfolio (the caller already checked portfolio ownership).
 * `lock` takes a row lock (`FOR UPDATE`) for the rest of the surrounding transaction: every
 * schedule edit rewrites the whole jsonb from what it read, so two concurrent edits of the
 * same loan must serialize or one silently loses the other's change.
 */
export async function loadLoan(
  db: Exec,
  portfolioId: string,
  loanId: string,
  opts: { lock?: boolean } = {},
): Promise<LoanRow> {
  const query = db
    .select()
    .from(loans)
    .where(and(eq(loans.id, loanId), eq(loans.portfolioId, portfolioId)));
  const [loan] = await (opts.lock ? query.for("update") : query);
  if (!loan) throw new LoanActionError(404, "loan_not_found");
  return loan;
}

/**
 * "Delete = skip". Called by the user-facing transaction delete routes only: removing an
 * installment's repayment flags that schedule row as skipped, so the booking job doesn't
 * re-book it; removing a payoff repayment reopens the loan. Internal removals (payoff/reopen
 * below) deliberately do NOT come through here — they must not flag rows as skipped.
 */
export async function onLoanLegsDeleted(
  db: Exec,
  deleted: {
    type: string;
    loanId: string | null;
    installmentN: number | null;
    externalId: string | null;
  }[],
): Promise<void> {
  const skipByLoan = new Map<string, Set<number>>();
  const reopen = new Set<string>();
  for (const d of deleted) {
    if (d.type !== "loan_repayment" || d.loanId === null) continue;
    if (d.installmentN !== null) {
      const set = skipByLoan.get(d.loanId) ?? new Set<number>();
      set.add(d.installmentN);
      skipByLoan.set(d.loanId, set);
    } else if (d.externalId === payoffExternalId(d.loanId)) {
      reopen.add(d.loanId);
    }
  }
  for (const [loanId, ns] of skipByLoan) {
    const [loan] = await db.select().from(loans).where(eq(loans.id, loanId)).for("update");
    if (!loan) continue;
    await db
      .update(loans)
      .set({ schedule: withSkipped(loan.schedule, ns, true) })
      .where(eq(loans.id, loanId));
  }
  if (reopen.size > 0) {
    await db
      .update(loans)
      .set({ closedAt: null })
      .where(inArray(loans.id, [...reopen]));
  }
}

function scheduleRow(loan: LoanRow, n: number) {
  const row = asScheduleRows(loan.schedule).find((r) => r.n === n);
  if (!row) throw new LoanActionError(404, "installment_not_found");
  return row;
}

/** Skip an installment: it is never booked, and a repayment already booked for it is removed. */
export async function skipInstallment(
  db: DB,
  portfolioId: string,
  loanId: string,
  n: number,
): Promise<void> {
  const dueDate = await db.transaction(async (tx) => {
    const loan = await loadLoan(tx, portfolioId, loanId, { lock: true });
    const row = scheduleRow(loan, n);
    if (loan.closedAt) throw new LoanActionError(409, "loan_closed");
    await tx
      .update(loans)
      .set({ schedule: withSkipped(loan.schedule, new Set([n]), true) })
      .where(eq(loans.id, loanId));
    await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.loanId, loanId),
          eq(transactions.type, "loan_repayment"),
          eq(transactions.installmentN, n),
        ),
      );
    return row.dueDate;
  });
  await enqueueRecompute(portfolioId, dueDate);
}

/** Undo a skip: the installment is booked again right away if it is already due. */
export async function unskipInstallment(
  db: DB,
  portfolioId: string,
  loanId: string,
  n: number,
  now: Date = new Date(),
): Promise<void> {
  const dueDate = await db.transaction(async (tx) => {
    const loan = await loadLoan(tx, portfolioId, loanId, { lock: true });
    const row = scheduleRow(loan, n);
    await tx
      .update(loans)
      .set({ schedule: withSkipped(loan.schedule, new Set([n]), false) })
      .where(eq(loans.id, loanId));
    return row.dueDate;
  });
  // The flag is committed, so even if booking fails the next daily run books it.
  await bookDueInstallments(db, now, { loanId });
  await enqueueRecompute(portfolioId, dueDate);
}

/**
 * Pay the loan off early: one repayment settles the remaining principal (plus an optional
 * fee, e.g. a penalty or the remaining margin) on `date`, and the loan stops booking.
 */
export async function payoffLoan(
  db: DB,
  portfolioId: string,
  loanId: string,
  input: { date: string; fees?: string },
  now: Date = new Date(),
): Promise<{ principal: string }> {
  // The whole decision — closed? how much is still owed? — runs under the loan's row lock
  // (the booking job takes the same one), so two payoffs, or a payoff racing the job, can't
  // both pass the checks or pay a balance an installment is about to change.
  const principal = await db.transaction(async (tx) => {
    const loan = await loadLoan(tx, portfolioId, loanId, { lock: true });
    if (loan.closedAt) throw new LoanActionError(409, "loan_closed");
    if (input.date > toDateKey(now)) throw new LoanActionError(400, "payoff_in_future");

    const rows = await tx.select().from(transactions).where(eq(transactions.loanId, loanId));
    const legs = toCoreTxns(rows);
    const lastRepayment = legs
      .filter((t) => t.type === "loan_repayment")
      .map((t) => toDateKey(t.executedAt))
      .sort()
      .pop();
    // A payoff dated before a booked repayment would leave that repayment "after" the loan
    // closed.
    if (lastRepayment && input.date < lastRepayment) {
      throw new LoanActionError(400, "payoff_before_last_repayment");
    }
    const outstanding = new Decimal(loanBalances(legs)[loanId] ?? "0");
    if (outstanding.lte(0)) throw new LoanActionError(409, "nothing_outstanding");

    const source = rows.find((r) => r.type === "loan_drawdown")?.source ?? "manual";
    await tx.insert(transactions).values({
      portfolioId,
      instrumentId: null,
      type: "loan_repayment",
      quantity: "0",
      price: outstanding.toString(),
      fees: new Decimal(input.fees ?? "0").toString(),
      currency: loan.currency,
      executedAt: new Date(`${input.date}T00:00:00.000Z`),
      source,
      importId: loan.importId,
      loanId,
      installmentN: null,
      externalId: payoffExternalId(loanId),
    });
    await tx.update(loans).set({ closedAt: input.date }).where(eq(loans.id, loanId));
    return outstanding.toString();
  });
  await enqueueRecompute(portfolioId, input.date);
  return { principal };
}

/** Undo an early payoff: remove the payoff repayment and resume booking the schedule. */
export async function reopenLoan(
  db: DB,
  portfolioId: string,
  loanId: string,
  now: Date = new Date(),
): Promise<void> {
  const closedAt = await db.transaction(async (tx) => {
    const loan = await loadLoan(tx, portfolioId, loanId, { lock: true });
    if (!loan.closedAt) throw new LoanActionError(409, "loan_not_closed");
    await tx
      .delete(transactions)
      .where(
        and(eq(transactions.loanId, loanId), eq(transactions.externalId, payoffExternalId(loanId))),
      );
    await tx.update(loans).set({ closedAt: null }).where(eq(loans.id, loanId));
    return loan.closedAt;
  });
  // `closedAt` is cleared and committed, so even if booking fails the next daily run books it.
  await bookDueInstallments(db, now, { loanId });
  await enqueueRecompute(portfolioId, closedAt);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The externalId of an auto-booked installment (`bookDueInstallments`) — its link is fixed. */
export const isAutoBookedLeg = (externalId: string | null | undefined) =>
  externalId != null && /^loan:[^:]+:(inst:\d+|payoff)$/.test(externalId);

/**
 * Validate (and lock) the loan a manual `loan_repayment` is being linked to, inside the
 * caller's db transaction. Takes the loan's row lock — the booking job, skip and payoff take
 * the same one — so a link can't race the job into booking an installment twice. Paying a
 * skipped installment clears its skip flag. `excludeTxId` is the row being edited, so
 * re-saving an existing link isn't a conflict with itself.
 */
export async function validateLoanLink(
  db: Exec,
  portfolioId: string,
  link: { loanId: string; installmentN?: number | null; currency: string; excludeTxId?: string },
): Promise<void> {
  const loan = await loadLoan(db, portfolioId, link.loanId, { lock: true });
  if (loan.closedAt) throw new LoanActionError(409, "loan_closed");
  if (link.currency !== loan.currency) throw new LoanActionError(400, "currency_mismatch");
  const n = link.installmentN;
  if (n == null) return;

  const row = scheduleRow(loan, n);
  const clashing = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.loanId, link.loanId),
        eq(transactions.type, "loan_repayment"),
        eq(transactions.installmentN, n),
      ),
    );
  if (clashing.some((t) => t.id !== link.excludeTxId)) {
    throw new LoanActionError(409, "installment_already_paid");
  }
  // Paying a skipped installment settles it, so it must not stay flagged as skipped.
  await db
    .update(loans)
    .set({ schedule: withSkipped(loan.schedule, new Set([row.n]), false) })
    .where(eq(loans.id, link.loanId));
}

export interface PortfolioLoanOption {
  loanId: string;
  provider: string | null;
  contractNo: string | null;
  currency: string;
  closedAt: string | null;
  installments: {
    n: number;
    dueDate: string;
    principal: string;
    margin: string;
    status: "paid" | "skipped" | "overdue" | "upcoming" | "closed";
  }[];
}

/** Picker feed for linking a manual repayment: each loan with its installments' status. */
export async function listPortfolioLoans(
  db: Exec,
  portfolioId: string,
  now: Date = new Date(),
): Promise<PortfolioLoanOption[]> {
  const loanRows = await db.select().from(loans).where(eq(loans.portfolioId, portfolioId));
  if (loanRows.length === 0) return [];
  const rows = await db
    .select()
    .from(transactions)
    .where(
      inArray(
        transactions.loanId,
        loanRows.map((l) => l.id),
      ),
    );
  const legs = toCoreTxns(rows);
  const today = isoDay(now);
  return loanRows.map((l) => {
    const plan = summarizeGoldPlan(
      {
        id: l.id,
        instrumentId: l.instrumentId,
        provider: l.provider,
        contractNo: l.contractNo,
        currency: l.currency,
        purchasePrice: l.purchasePrice,
        downPayment: l.downPayment,
        principal: l.principal,
        marginTotal: l.marginTotal,
        tenorMonths: l.tenorMonths,
        monthlyInstallment: l.monthlyInstallment,
        startDate: l.startDate,
        schedule: l.schedule,
        closedAt: l.closedAt,
      },
      legs,
      today,
    );
    return {
      loanId: l.id,
      provider: l.provider,
      contractNo: l.contractNo,
      currency: l.currency,
      closedAt: l.closedAt,
      installments: plan.schedule.map((r) => ({
        n: r.n,
        dueDate: r.dueDate,
        principal: r.pokok,
        margin: r.sewaModal,
        status: r.paid
          ? "paid"
          : r.closed
            ? "closed"
            : r.skipped
              ? "skipped"
              : r.overdue
                ? "overdue"
                : "upcoming",
      })),
    };
  });
}
