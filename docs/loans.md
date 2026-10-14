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

A repayment recorded by hand today can't be linked to a loan (tracked in #955), so it carries
no installment number: it reduces the net-worth liabilities, but it neither marks an
installment paid nor stops the next scheduled one from being booked.

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

## Manual repayments

A repayment recorded by hand (Add transaction → Cash → _Loan repayment_, offered when the
portfolio has an open loan) can be **linked to a loan and, optionally, one installment**
(`loanId` / `installmentN` on the transaction payload). Linked to an installment, it counts as
that installment's payment: the plan card shows it paid and the job never books it. Linked to
the loan alone, it reduces the loan's balance without settling a particular row.

- The loan must belong to the portfolio (`loan_not_found`), be open (`loan_closed`) and share
  the repayment's currency (`currency_mismatch`); the installment must exist in the schedule
  (`installment_not_found`) and have no other repayment (`installment_already_paid`).
- Paying a **skipped** installment clears its skip flag.
- Editing keeps the link unless the payload changes it (omit the fields to leave it alone,
  `null` to unlink). Re-pointing or unlinking a repayment leaves the old installment unpaid —
  it is _not_ marked skipped — so the job books it if it is due. Changing the type away from
  a loan repayment drops the link.
- The link of a repayment the schedule booked itself (`loan:<id>:inst:<n>` / `…:payoff`) is
  fixed (`loan_link_locked`); its amounts stay editable.

## API

All routes are under `/portfolios/:portfolioId/loans/:loanId` and scoped to the portfolio's
owner.

| Method & path                 | Does                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `POST installments/:n/skip`   | Skip installment `n` (idempotent).                           |
| `DELETE installments/:n/skip` | Restore it.                                                  |
| `POST payoff`                 | Body `{ date: "YYYY-MM-DD", fees?: "…" }` → `{ principal }`. |
| `DELETE payoff`               | Undo an early payoff.                                        |

`GET /portfolios/:portfolioId/loans` lists the portfolio's loans with each installment's
status (`paid`, `skipped`, `overdue`, `upcoming`, `closed`) — the feed for the repayment
form's loan picker.

Errors are `{ error: code }`: `loan_not_found`, `installment_not_found`, `loan_closed`,
`loan_not_closed`, `payoff_in_future`, `payoff_before_last_repayment`, `nothing_outstanding`; linking a manual
repayment adds `currency_mismatch`, `installment_already_paid` and `loan_link_locked`.

## Data

- `transactions.installment_n` (smallint, nullable) — the installment a `loan_repayment`
  settles. The migration backfills it from the externalId for job-booked rows and, for
  import-booked rows, against the earliest installments no repayment covers yet (what the old
  count rule showed as paid).
- `loans.closed_at` (date, nullable) — the early-payoff date.
- `loans.schedule[].skipped` (boolean, optional) — the skip flag.
