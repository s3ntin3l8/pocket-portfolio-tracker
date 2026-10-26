import { Decimal } from "decimal.js";

// Cross-endpoint invariants over already-fetched response bodies. Every rule is a pure function
// from bodies to findings, so the same code checks a hand-built ledger in a test and a real
// user's data (read-only) — a failing rule names itself, its scope, and expected vs. actual.
//
// A rule belongs here only if it follows strictly from a documented definition. A convenient
// identity that fees/taxes/boundaries legitimately break (e.g. value − contributed =
// unrealized + realized + income) would report false positives on real data; leave it out.

export const RULE_IDS = [
  "NW_SUM_PORTFOLIOS",
  "GAIN_MATCHES_TOTALS",
  "HOLDINGS_SUM",
  "NW_COMPOSITION",
  "FX_MISSING_DISCLOSED",
  "VALUED_AT_COST_NO_GAIN",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export interface Finding {
  rule: RuleId;
  /** `"networth"` or `"portfolio:<id>"`. */
  scope: string;
  expected: string;
  actual: string;
  diff: string;
  tolerance: string;
  message: string;
}

export interface HoldingBody {
  instrumentId: string;
  currency: string | null;
  costCurrency?: string | null;
  marketValueDisplay: string | null;
  costBasisDisplay: string;
  unrealizedPnLDisplay: string | null;
  valuedAtCost?: boolean;
  fxMissing?: boolean;
}

export interface GainBody {
  value: string;
  costOfOpen: string;
  netContributed: string;
  unrealized: string;
  realized: string;
  income: string;
}

/** The valuation block `/networth` and `/portfolios/:id/summary` share. */
export interface ValuationBody {
  /** A portfolio summary is in the portfolio's base currency; `/networth` in the user's. */
  displayCurrency: string;
  netWorth: string;
  totalCost: string;
  totalMarketValue: string;
  totalUnrealizedPnL: string;
  totalRealizedPnL: string;
  totalIncome: string;
  totalLiabilities: string;
  cashTracked: boolean;
  cashDisplay: Record<string, string>;
  holdings: HoldingBody[];
  fxMissingCurrencies: string[];
  gain?: GainBody;
}

/** `/networth` also says which instant it was computed for. */
export type NetWorthBody = ValuationBody & { asOf: string };

export interface IntegrityBodies {
  networth: NetWorthBody;
  portfolios: { id: string; summary: ValuationBody }[];
  /**
   * Today's rate from each portfolio currency into `networth.displayCurrency` (`/fx-rate`);
   * `null` when the app has none. The same currency maps to "1".
   */
  fxToDisplay: Record<string, string | null>;
}

/** Relative 1e-9 with an absolute floor: Decimal strings carry ~20 significant digits. */
function tolerance(expected: Decimal): Decimal {
  return Decimal.max("1e-9", expected.abs().mul("1e-9"));
}

function compare(
  rule: RuleId,
  scope: string,
  message: string,
  expected: Decimal,
  actual: Decimal,
  tol: Decimal = tolerance(expected),
): Finding[] {
  const diff = actual.sub(expected).abs();
  if (diff.lte(tol)) return [];
  return [
    {
      rule,
      scope,
      expected: expected.toString(),
      actual: actual.toString(),
      diff: diff.toString(),
      tolerance: tol.toString(),
      message,
    },
  ];
}

const sum = (xs: Iterable<string>): Decimal =>
  [...xs].reduce((acc, x) => acc.add(x), new Decimal(0));

/**
 * /networth is the sum of the portfolios it aggregates, each converted from its own base
 * currency into the user's display currency. With no rate for one of those currencies the
 * app excludes it from /networth too, so there is nothing sound to compare: the rule abstains.
 *
 * Assumes the summary's base-currency total, converted by today's `/fx-rate`, agrees with
 * /networth converting each holding from its native currency. That holds while every
 * (from → base) rate comes from the same provider day; a degraded provider can carry one pair
 * forward (up to FX_MAX_CARRY_FORWARD_DAYS) and drift the two paths apart by real FX movement —
 * a finding then is a data-freshness signal, not necessarily a calculation bug.
 */
export function checkNetWorthSumsPortfolios(b: IntegrityBodies): Finding[] {
  let expected = new Decimal(0);
  for (const p of b.portfolios) {
    const rate =
      p.summary.displayCurrency === b.networth.displayCurrency
        ? "1"
        : b.fxToDisplay[p.summary.displayCurrency];
    if (rate == null) return [];
    expected = expected.add(new Decimal(p.summary.netWorth).mul(rate));
  }
  return compare(
    "NW_SUM_PORTFOLIOS",
    "networth",
    "/networth netWorth differs from the sum of the portfolio summaries (converted at today's rate)",
    expected,
    new Decimal(b.networth.netWorth),
  );
}

function scopes(b: IntegrityBodies): { scope: string; v: ValuationBody }[] {
  return [
    { scope: "networth", v: b.networth },
    ...b.portfolios.map((p) => ({ scope: `portfolio:${p.id}`, v: p.summary })),
  ];
}

/** GainSummary is built from the same valuation: its fields must be the response's totals. */
export function checkGainMatchesTotals(b: IntegrityBodies): Finding[] {
  const out: Finding[] = [];
  for (const { scope, v } of scopes(b)) {
    if (!v.gain) continue;
    const pairs: [string, string, string][] = [
      ["value", v.netWorth, v.gain.value],
      ["costOfOpen", v.totalCost, v.gain.costOfOpen],
      ["unrealized", v.totalUnrealizedPnL, v.gain.unrealized],
      ["realized", v.totalRealizedPnL, v.gain.realized],
      ["income", v.totalIncome, v.gain.income],
    ];
    for (const [field, total, gain] of pairs) {
      out.push(
        ...compare(
          "GAIN_MATCHES_TOTALS",
          scope,
          `gain.${field} differs from the response's own total`,
          new Decimal(total),
          new Decimal(gain),
        ),
      );
    }
  }
  return out;
}

/**
 * Totals are the sums of their holdings' display figures. A holding the app could not convert
 * carries null display values, so the null-skip is what excludes it. Do NOT also filter on
 * `fxMissing`: the aggregate OR-merges that flag while summing the display values, so a merged
 * holding can be flagged and still carry the other depot's value (`aggregatePortfolios`).
 */
export function checkHoldingsSum(b: IntegrityBodies): Finding[] {
  const out: Finding[] = [];
  for (const { scope, v } of scopes(b)) {
    const counted = v.holdings;
    out.push(
      ...compare(
        "HOLDINGS_SUM",
        scope,
        "totalMarketValue differs from the sum of the holdings' marketValueDisplay",
        sum(counted.flatMap((h) => (h.marketValueDisplay == null ? [] : [h.marketValueDisplay]))),
        new Decimal(v.totalMarketValue),
      ),
      ...compare(
        "HOLDINGS_SUM",
        scope,
        "totalUnrealizedPnL differs from the sum of the holdings' unrealizedPnLDisplay",
        sum(
          counted.flatMap((h) => (h.unrealizedPnLDisplay == null ? [] : [h.unrealizedPnLDisplay])),
        ),
        new Decimal(v.totalUnrealizedPnL),
      ),
    );
  }
  return out;
}

/** Net worth = securities + counted cash − liabilities (cash only when tracked and inside). */
export function checkNetWorthComposition(b: IntegrityBodies): Finding[] {
  const out: Finding[] = [];
  for (const { scope, v } of scopes(b)) {
    const cash = v.cashTracked ? sum(Object.values(v.cashDisplay)) : new Decimal(0);
    const expected = new Decimal(v.totalMarketValue).add(cash).sub(v.totalLiabilities);
    out.push(
      ...compare(
        "NW_COMPOSITION",
        scope,
        "netWorth differs from totalMarketValue + counted cash − liabilities",
        expected,
        new Decimal(v.netWorth),
      ),
    );
  }
  return out;
}

/** A holding that could not be converted must be disclosed, not silently dropped. */
export function checkFxMissingDisclosed(b: IntegrityBodies): Finding[] {
  const out: Finding[] = [];
  for (const { scope, v } of scopes(b)) {
    const flagged = v.holdings.some((h) => h.fxMissing);
    if (flagged && v.fxMissingCurrencies.length === 0) {
      out.push({
        rule: "FX_MISSING_DISCLOSED",
        scope,
        expected: "at least one currency in fxMissingCurrencies",
        actual: "[]",
        diff: "n/a",
        tolerance: "n/a",
        message: "a holding is flagged fxMissing but fxMissingCurrencies is empty",
      });
    }
    // The inverse also holds for a holding's own currencies.
    for (const h of v.holdings) {
      if (!h.fxMissing) continue;
      const ccys = [h.currency, h.costCurrency].filter((c): c is string => !!c);
      if (ccys.length > 0 && !ccys.some((c) => v.fxMissingCurrencies.includes(c))) {
        out.push({
          rule: "FX_MISSING_DISCLOSED",
          scope,
          expected: `one of ${ccys.join(",")} in fxMissingCurrencies`,
          actual: `[${v.fxMissingCurrencies.join(",")}]`,
          diff: "n/a",
          tolerance: "n/a",
          message: `fxMissing holding ${h.instrumentId} is not covered by fxMissingCurrencies`,
        });
      }
    }
  }
  return out;
}

/** A holding valued at cost has no measured gain: null or zero, never a phantom P&L. */
export function checkValuedAtCostHasNoGain(b: IntegrityBodies): Finding[] {
  const out: Finding[] = [];
  for (const { scope, v } of scopes(b)) {
    for (const h of v.holdings) {
      if (!h.valuedAtCost || h.unrealizedPnLDisplay == null) continue;
      out.push(
        ...compare(
          "VALUED_AT_COST_NO_GAIN",
          scope,
          `valuedAtCost holding ${h.instrumentId} reports an unrealized gain`,
          new Decimal(0),
          new Decimal(h.unrealizedPnLDisplay),
          new Decimal("1e-9"),
        ),
      );
    }
  }
  return out;
}

export const RULES: ((b: IntegrityBodies) => Finding[])[] = [
  checkNetWorthSumsPortfolios,
  checkGainMatchesTotals,
  checkHoldingsSum,
  checkNetWorthComposition,
  checkFxMissingDisclosed,
  checkValuedAtCostHasNoGain,
];

export function checkIntegrity(b: IntegrityBodies): Finding[] {
  return RULES.flatMap((rule) => rule(b));
}
