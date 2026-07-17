export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export const DEPOSIT_TYPES = new Set([
  "CUSTOMER_INBOUND",
  "CUSTOMER_INPAYMENT",
  "TRANSFER_INBOUND",
  "TRANSFER_INSTANT_INBOUND",
  // Incoming cash transfer (e.g. a parent funding a child's JUNIOR depot). Cash, not a
  // securities transfer — plain deposit, no `kind` (cf. the share-in FREE_RECEIPT below).
  "TRANSFER_IN",
]);
export const WITHDRAWAL_TYPES = new Set([
  "CUSTOMER_OUTBOUND_REQUEST",
  "TRANSFER_OUT",
  "TRANSFER_OUTBOUND",
  "TRANSFER_INSTANT_OUTBOUND",
]);
// Debit-card spending (and the one-off card fee) draws down the TR cash balance, so it is
// recorded as a withdrawal — matching the pytr mapper. Users omit these at review if wanted.
export const CARD_TYPES = new Set(["CARD_TRANSACTION", "CARD_TRANSACTION_INTERNATIONAL"]);
export const DIVIDEND_TYPES = new Set(["DIVIDEND", "DISTRIBUTION"]);
// Reward credits with no share leg of their own (cashback / promos). Broker-credited money,
// not a user contribution — excluded from contributed capital. All map to action `bonus_cash`
// + kind `bonus`; collapsePerkFundedAcquisitions then folds each into the savings-plan buy it
// funds (0–4 days later), so a reward-funded buy becomes a single `bonus` free-share row
// instead of an income leg + a buy that wrongly counts as contributed capital. A reward with
// no matching buy stays a `bonus_cash` income row (still return, still contribution-excluded).
//
//   BENEFITS_SAVEBACK — saveback cashback reinvested into the chosen ETF (verified 1:1 against
//     real exports: every saveback funds a same-week buy). The pytr live path books the same
//     event as a cash-neutral `savings_plan`+`saveback`; the two dedup via the acquire class.
//   KINDERGELD_BONUS — TR cash credit on the Kindergeld feature.
//   STOCKPERK — reward credited as cash (row may carry an instrument field but no share count).
//   BONUS — promo / crypto one-percent bonus compensation.
export const CASH_BONUS_TYPES = new Set([
  "BONUS",
  "KINDERGELD_BONUS",
  "STOCKPERK",
  "BENEFITS_SAVEBACK",
]);
// Shares received with no cash consideration → bonus (quantity = received shares, price 0).
export const SHARE_IN_TYPES = new Set(["FREE_RECEIPT", "DIVIDEND_OPTION", "DIVIDEND_REINVESTMENT"]);
// Recognised but not representable as a single transaction leg — surfaced for manual
// handling rather than guessed. Rare (5 rows in the reference export).
export const UNSUPPORTED = new Map<string, string>([
  ["TAX_OPTIMIZATION", "tax-optimisation adjustment (no transaction leg)"],
  ["SEC_ACCOUNT", "securities-account tax adjustment (no transaction leg)"],
  ["DIVIDEND_OPTION_CANCELLED", "reversal of a dividend-option election"],
]);

// TR exports HTML-escape security names (e.g. "Core S&amp;P 500"). Decode in a single pass
// so a replacement can't be re-interpreted as another entity (no double-unescaping).
export const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};
