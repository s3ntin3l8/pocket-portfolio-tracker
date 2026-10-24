import { Decimal } from "decimal.js";
import { D } from "./decimal.js";
import { INCOME_TYPES } from "./categorization.js";
import type { CoreTransaction } from "./types.js";

/** Signed cash effect of a single transaction (positive = cash in). */
export function cashFlow(tx: CoreTransaction): Decimal {
  const q = D(tx.quantity);
  const p = D(tx.price);
  const f = D(tx.fees);
  const notional = q.mul(p);

  // Archived + draft rows should be filtered out upstream; if one reaches here, treat it
  // as having no cash effect at all (belt-and-suspenders so it can never inflate cash).
  if (tx.status === "archived" || tx.status === "draft") return new Decimal(0);
  // Reward-funded acquisitions whose funding leg the feed omits: the reward covers the
  // principal, so only fees (≈0) touch cash. Shares still build cost basis (holdings is
  // unaffected). Same effect as the kind-based saveback/crypto_bonus shortcut below.
  if (tx.status === "cash_neutral") return f.neg();

  switch (tx.type) {
    case "deposit":
      return p.sub(f);
    case "withdrawal":
      return p.neg().sub(f);
    case "buy":
    case "savings_plan":
      // Reward-funded purchases (saveback cashback, crypto "1% bonus") are funded by a TR
      // reward that exactly equals the invested amount and is NOT emitted as a separate
      // cash-credit on the timeline feed. Their net cash effect is zero — the reward covers
      // the principal; only fees (≈0) touch cash. The shares still build cost basis.
      // Round-ups (`kind:"roundup"`) are the user's OWN spare change → a real cash-out, unchanged.
      if (tx.kind === "saveback" || tx.kind === "crypto_bonus") return f.neg();
      return notional.neg().sub(f);
    case "sell":
      // Gross sell proceeds minus fees and capital-gains tax withheld. `price` must be
      // the gross per-share price (not net-of-tax) so that P&L stays pre-tax while cash
      // is correctly net-of-tax. See PR #312 for the pytr/CSV path alignment.
      //
      // Deliberately the FULL quantity's proceeds, even when the sell exceeds the held
      // quantity (an over-sell). Holdings/trade-log clamp the disposal to what is held,
      // but cash is a ledger of money that actually moved: the broker credited every
      // share sold, so clamping here would make the derived balance disagree with the
      // broker's (and break the IBKR/TR cash reconciliation). The over-sell itself is a
      // missing-acquisition data defect, surfaced by detectAnomalies' `oversell` /
      // `sell_before_acquisition` with the disputed amount as `excessProceeds` (audit B13).
      return notional.sub(f).sub(D(tx.tax ?? "0"));
    case "dividend":
    case "coupon":
    case "interest":
    case "bonus_cash":
      // Income: per-unit (qty>0) or a lump sum recorded in price. Interest/bonus_cash are
      // always lump sums (no instrument) — cash in, never a contribution.
      return (q.gt(0) ? notional : p).sub(f);
    case "fee":
    case "tax":
      // `tax` = a standalone tax debit (e.g. Vorabpauschale): the magnitude is in `price`,
      // a cash outflow. Like `fee` — never income, never a contribution.
      return p.neg().sub(f);
    case "loan_drawdown":
      // Financed cash arrives; it is immediately spent on the paired buy, so the
      // two legs are net-neutral on the contract date.
      return p;
    case "loan_repayment":
      // An installment: principal (price) + financing margin (fees) leave cash.
      return p.neg().sub(f);
    case "split":
    case "bonus":
    case "rights":
    case "transfer_in":
    case "transfer_out":
      // Securities transfers are cash-neutral — only fees (typically 0) affect cash.
      return f.neg();
    case "adjustment":
      // Manual signed true-up: `price` IS the signed delta the user entered (not an
      // unsigned magnitude with sign derived from type, unlike fee/tax/deposit/withdrawal).
      return p.sub(f);
    default:
      return new Decimal(0);
  }
}

/**
 * The income a single transaction contributes to the portfolio's "Income" figure.
 *
 * **One definition, used everywhere.** The transactions list shows an "Income" total and
 * the portfolio summary (and the Gain explainer that reads it) show another; two
 * definitions of the same word meant a €20 broker bonus read as "Income €20" on one
 * screen and "Income €0" on the other — and the assistant tool was handed the second
 * one, so it answered "you earned €0" while the app's own banner said €20.
 *
 * The rule is the transactions list's: income is `dividend | coupon | interest |
 * bonus_cash`, valued per-unit when the row carries a quantity and as a lump sum in
 * `price` otherwise, minus fees — and a standalone `tax` debit (the Vorabpauschale)
 * reduces it. That is exactly `cashFlow()` over those rows.
 */
export function incomeFlow(tx: CoreTransaction): Decimal {
  // The same set the transactions list's summary uses: the four income types, plus a
  // standalone `tax` debit (the Vorabpauschale) which reduces the total. A standalone
  // `fee` row is NOT part of it — the list's income summary doesn't count it either, and
  // counting it here would make the total disagree with the tile above it.
  if ((INCOME_TYPES as readonly string[]).includes(tx.type) || tx.type === "tax") {
    return cashFlow(tx);
  }
  return new Decimal(0);
}

/**
 * Whether a transaction is an explicit cash-account movement: an external deposit or
 * withdrawal, a financing leg (loan drawdown/repayment), or a manual cash true-up
 * (`adjustment`). Cash derived from transactions is only a real balance once at least one
 * of these exists; before that it is just the sum of imported buys/sells, typically a
 * phantom negative (see `netWorthInputs`'s `cashTracked`).
 */
export function isCashAccountMovement(tx: CoreTransaction): boolean {
  return (
    tx.type === "deposit" ||
    tx.type === "withdrawal" ||
    tx.type === "loan_drawdown" ||
    tx.type === "loan_repayment" ||
    tx.type === "adjustment"
  );
}

/** Uninvested cash balance per currency, derived from all transactions. */
export function cashBalances(transactions: CoreTransaction[]): Record<string, string> {
  const totals = new Map<string, Decimal>();
  for (const tx of transactions) {
    const cur = tx.currency;
    totals.set(cur, (totals.get(cur) ?? new Decimal(0)).add(cashFlow(tx)));
  }
  const out: Record<string, string> = {};
  for (const [cur, total] of totals) out[cur] = total.toString();
  return out;
}
