import { and, eq, isNotNull } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { loans, transactions } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type { DB } from "../db/client.js";
import { enqueueRecompute } from "./scheduler/enqueue.js";

/** One row of a financed gold contract's repayment schedule, as stored in `loans.schedule`. */
interface ScheduleRow {
  n: number;
  dueDate: string;
  pokok: string;
  sewaModal: string;
}

function asScheduleRows(schedule: unknown): ScheduleRow[] {
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
 * Idempotent two ways: installments the import already booked are matched by due **date**
 * (their externalIds are leg-indexed, not installment-numbered), and auto-booked rows carry a
 * stable `loan:<loanId>:inst:<n>` externalId under the `(portfolioId, source, externalId)`
 * unique index. The rows inherit the loan's `importId`, so undoing the import removes them.
 *
 * Known limitation: a booked installment the user deletes is re-booked on the next run —
 * there is no "skip" or early-payoff state yet.
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

  for (const loan of loanRows) {
    const due = asScheduleRows(loan.schedule).filter(
      (r) => new Date(`${r.dueDate}T00:00:00.000Z`).getTime() <= now.getTime(),
    );
    if (due.length === 0) continue;

    const existing = await db
      .select({
        type: transactions.type,
        executedAt: transactions.executedAt,
        source: transactions.source,
      })
      .from(transactions)
      .where(eq(transactions.loanId, loan.id));
    const bookedDays = new Set(
      existing.filter((t) => t.type === "loan_repayment").map((t) => toDateKey(t.executedAt)),
    );
    // Inherit the contract's own source (screenshot/pdf/…) so the rows group with its legs.
    const source = existing.find((t) => t.type === "loan_drawdown")?.source ?? "manual";

    for (const row of due) {
      if (bookedDays.has(row.dueDate)) continue;
      const [written] = await db
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
          externalId: `loan:${loan.id}:inst:${row.n}`,
        })
        .onConflictDoNothing()
        .returning({ id: transactions.id });
      if (!written) continue;
      booked++;
      const prev = earliestByPortfolio.get(loan.portfolioId);
      if (!prev || row.dueDate < prev) earliestByPortfolio.set(loan.portfolioId, row.dueDate);
    }
  }

  for (const [portfolioId, fromDate] of earliestByPortfolio) {
    await enqueueRecompute(portfolioId, fromDate);
  }
  return { booked };
}
