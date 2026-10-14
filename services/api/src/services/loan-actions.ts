import { and, eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { loans, transactions } from "@portfolio/db";
import { loanBalances, toDateKey } from "@portfolio/core";
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
  if (!Array.isArray(schedule)) return schedule;
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
  const loan = await loadLoan(db, portfolioId, loanId);
  if (loan.closedAt) throw new LoanActionError(409, "loan_closed");
  if (input.date > toDateKey(now)) throw new LoanActionError(400, "payoff_in_future");

  const rows = await db.select().from(transactions).where(eq(transactions.loanId, loanId));
  const legs = toCoreTxns(rows);
  const lastRepayment = legs
    .filter((t) => t.type === "loan_repayment")
    .map((t) => toDateKey(t.executedAt))
    .sort()
    .pop();
  // A payoff dated before a booked repayment would leave that repayment "after" the loan closed.
  if (lastRepayment && input.date < lastRepayment) {
    throw new LoanActionError(400, "payoff_before_last_repayment");
  }
  const outstanding = new Decimal(loanBalances(legs)[loanId] ?? "0");
  if (outstanding.lte(0)) throw new LoanActionError(409, "nothing_outstanding");

  const source = rows.find((r) => r.type === "loan_drawdown")?.source ?? "manual";
  await db.transaction(async (tx) => {
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
  });
  await enqueueRecompute(portfolioId, input.date);
  return { principal: outstanding.toString() };
}

/** Undo an early payoff: remove the payoff repayment and resume booking the schedule. */
export async function reopenLoan(
  db: DB,
  portfolioId: string,
  loanId: string,
  now: Date = new Date(),
): Promise<void> {
  const loan = await loadLoan(db, portfolioId, loanId);
  if (!loan.closedAt) throw new LoanActionError(409, "loan_not_closed");
  await db.transaction(async (tx) => {
    await tx
      .delete(transactions)
      .where(
        and(eq(transactions.loanId, loanId), eq(transactions.externalId, payoffExternalId(loanId))),
      );
    await tx.update(loans).set({ closedAt: null }).where(eq(loans.id, loanId));
  });
  // `closedAt` is cleared and committed, so even if booking fails the next daily run books it.
  await bookDueInstallments(db, now, { loanId });
  await enqueueRecompute(portfolioId, loan.closedAt);
}
