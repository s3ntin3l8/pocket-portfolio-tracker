# Financed gold purchases (cicilan)

A financed gold purchase (a Galeri 24 cicilan contract) is imported once from the contract
PDF/screenshot. The import writes the gold purchase, the loan drawdown and the installments
that were already due; the rest of the repayment schedule is kept in `loans.schedule` and
booked as it falls due. Loan legs sit outside the contribution boundary (cash-inside and
cash-outside portfolios alike), so the loan changes liabilities and net worth only.

## How installments get booked

`bookDueInstallments` (`services/api/src/services/loan-installments.ts`) runs daily (00:15)
and books every due installment as a `loan_repayment`: the principal (`pokok`) in `price`,
the financing margin (`sewaModal`) in `fees`, with the `loan:<loanId>:inst:<n>` externalId.

Each booked repayment names the schedule installment it settles in
`transactions.installment_n`. That explicit mapping is what "paid" means everywhere —
the job, the Gold report (`summarizeGoldPlan` in `packages/core/src/gold.ts`) and the loan
balance all agree on it. A repayment with no installment number (an early payoff, or a lump
sum recorded against the loan) still reduces the balance but never marks an installment paid
and never stops a scheduled one from being booked.

## Departing from the schedule

All of this is on the Gold report's plan card.

- **Skip an installment** (row ⋯ menu). The row is flagged `skipped` in `loans.schedule`, any
  repayment already booked for it is removed, and the job never books it. Its principal
  **stays owed** — the loan balance doesn't drop — until you restore the installment (it is
  booked again immediately if it is already due) or pay the loan off.
- **Deleting an auto-booked installment is the same as skipping it.** Deleting the repayment
  from the transactions list flags its schedule row, so the next daily run doesn't re-book it.
  Restore it from the plan card.
- **Pay off early.** One repayment settles the remaining principal on the chosen date (plus
  an optional fee, e.g. a penalty or the remaining margin), and `loans.closed_at` is set.
  A closed loan books nothing more; installments not paid on their own show as _Paid off_.
  The date can't be in the future or before the last booked repayment. **Undo payoff**
  removes that repayment and resumes the schedule (past-due installments are booked again
  straight away). Deleting the payoff repayment by hand reopens the loan too.

## API

All routes are under `/portfolios/:portfolioId/loans/:loanId` and scoped to the portfolio's
owner.

| Method & path                 | Does                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `POST installments/:n/skip`   | Skip installment `n` (idempotent).                           |
| `DELETE installments/:n/skip` | Restore it.                                                  |
| `POST payoff`                 | Body `{ date: "YYYY-MM-DD", fees?: "…" }` → `{ principal }`. |
| `DELETE payoff`               | Undo an early payoff.                                        |

Errors are `{ error: code }`: `loan_not_found`, `installment_not_found`, `loan_closed`,
`loan_not_closed`, `payoff_in_future`, `payoff_before_last_repayment`, `nothing_outstanding`.

## Data

- `transactions.installment_n` (smallint, nullable) — the installment a `loan_repayment`
  settles. The migration backfills it from the externalId for job-booked rows and, for
  import-booked rows, against the earliest installments no repayment covers yet (what the old
  count rule showed as paid).
- `loans.closed_at` (date, nullable) — the early-payoff date.
- `loans.schedule[].skipped` (boolean, optional) — the skip flag.
