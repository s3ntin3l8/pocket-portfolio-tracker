import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { loans, transactions } from "@portfolio/db";
import type { DB } from "../db/client.js";
import { enqueueRecompute } from "./scheduler/enqueue.js";

/** One row of a financed gold contract's repayment schedule, as stored in `loans.schedule`. */
export interface ScheduleRow {
  n: number;
  dueDate: string;
  pokok: string;
  sewaModal: string;
  /** The user skipped this installment: never (re-)booked, its principal stays owed. */
  skipped?: boolean;
}

export function asScheduleRows(schedule: unknown): ScheduleRow[] {
  if (!Array.isArray(schedule)) return [];
  return schedule.filter(
    (r): r is ScheduleRow =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as ScheduleRow).n === "number" &&
      typeof (r as ScheduleRow).dueDate === "string" &&
      typeof (r as ScheduleRow).pokok === "string" &&
      typeof (r as ScheduleRow).sewaModal === "string",
  );
}

/**
 * Book every scheduled loan installment that has fallen due as a `loan_repayment`.
 *
 * A confirmed gold-purchase contract (cicilan) only books the installments that were
 * already due at import time (`buildContractLegs`); the rest live in `loans.schedule`.
 * Without this job the outstanding loan — and so net worth — stays frozen at the import
 * date. Run daily (and safe to run any time): each due installment is written once.
 *
 * Idempotent two ways. Each booked repayment names the installment it settles
 * (`transactions.installmentN`), so an installment is skipped when a repayment already covers
 * it — whichever day it was actually paid — while an extra or partial repayment that names no
 * installment never suppresses a scheduled one. Auto-booked rows also carry a stable
 * `loan:<loanId>:inst:<n>` externalId under the `(portfolioId, source, externalId)` unique
 * index, so a concurrent run can't double-write. The rows inherit the loan's `importId`, so
 * undoing the import removes them.
 *
 * The user can depart from the schedule: a row flagged `skipped` in `loans.schedule` is never
 * booked (deleting an auto-booked installment flags it, so it isn't re-booked either), and a
 * loan paid off early (`closedAt`) books nothing more.
 *
 * This is a deliberate exception to "imports never auto-commit": it writes transactions
 * without a review step, but only to materialise the repayment schedule the user already
 * confirmed when they imported the contract.
 */
export async function bookDueInstallments(
  db: DB,
  now: Date = new Date(),
  opts: { loanId?: string } = {},
): Promise<{ booked: number }> {
  const loanRows = await db
    .select()
    .from(loans)
    .where(
      opts.loanId
        ? and(isNotNull(loans.schedule), eq(loans.id, opts.loanId))
        : isNotNull(loans.schedule),
    );

  let booked = 0;
  // Earliest day booked per portfolio → one recompute from there covers the whole batch.
  const earliestByPortfolio = new Map<string, string>();

  for (const candidate of loanRows) {
    // One transaction per loan, under the same row lock the skip / payoff actions take, so a
    // payoff (or schedule edit) racing this job can't compute its balance from a stale view
    // and then have an installment booked underneath it.
    await db.transaction(async (tx) => {
      const [loan] = await tx.select().from(loans).where(eq(loans.id, candidate.id)).for("update");
      // Gone, or paid off early: the payoff repayment settled everything still owed.
      if (!loan || loan.closedAt) return;
      const due = asScheduleRows(loan.schedule)
        .filter(
          (r) => !r.skipped && new Date(`${r.dueDate}T00:00:00.000Z`).getTime() <= now.getTime(),
        )
        .sort((a, b) => a.n - b.n);
      if (due.length === 0) return;

      // Only the financing legs matter (which installments are covered, the drawdown for its
      // source), so the lookup stays one row per booked installment however long the loan ran.
      const existing = await tx
        .select({
          type: transactions.type,
          source: transactions.source,
          installmentN: transactions.installmentN,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.loanId, loan.id),
            inArray(transactions.type, ["loan_repayment", "loan_drawdown"]),
          ),
        );
      const covered = new Set(
        existing.flatMap((t) =>
          t.type === "loan_repayment" && t.installmentN != null ? [t.installmentN] : [],
        ),
      );
      // Inherit the contract's own source (screenshot/pdf/…) so the rows group with its legs.
      const source = existing.find((t) => t.type === "loan_drawdown")?.source ?? "manual";

      for (const row of due.filter((r) => !covered.has(r.n))) {
        const [written] = await tx
          .insert(transactions)
          .values({
            portfolioId: loan.portfolioId,
            instrumentId: null,
            type: "loan_repayment",
            quantity: "0",
            price: new Decimal(row.pokok).toString(),
            fees: new Decimal(row.sewaModal).toString(),
            currency: loan.currency,
            executedAt: new Date(`${row.dueDate}T00:00:00.000Z`),
            source,
            importId: loan.importId,
            loanId: loan.id,
            installmentN: row.n,
            externalId: `loan:${loan.id}:inst:${row.n}`,
          })
          .onConflictDoNothing()
          .returning({ id: transactions.id });
        if (!written) continue;
        booked++;
        const prev = earliestByPortfolio.get(loan.portfolioId);
        if (!prev || row.dueDate < prev) earliestByPortfolio.set(loan.portfolioId, row.dueDate);
      }
    });
  }

  for (const [portfolioId, fromDate] of earliestByPortfolio) {
    await enqueueRecompute(portfolioId, fromDate);
  }
  return { booked };
}
