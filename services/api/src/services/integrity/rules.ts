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
  "CONTRIB_PARITY",
  "REALIZED_PARITY",
  "ANOMALY_UNION",
  "HISTORY_ORDERED",
  "HISTORY_SUMS_PORTFOLIOS",
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

export interface AnomalyBody {
  code?: string;
  transactionId?: string | null;
  instrumentId?: string | null;
  meta?: Record<string, unknown>;
}

/** The other endpoints that restate a figure the valuation also carries. */
export interface ParityBodies {
  /** `/…/contributions`: `netContributed` is `gain.netContributed`. */
  contributions: { displayCurrency: string; netContributed: string };
  /** `/…/trades`: `totalRealized` is the valuation's `totalRealizedPnL`. */
  trades: { displayCurrency: string; totalRealized: string };
  /** `/…/anomalies`. */
  anomalies: { anomalies: AnomalyBody[] };
}

/** One point of a stored daily-snapshot series (`/networth/history`, `/portfolios/:id/history`). */
export interface HistoryPoint {
  date: string;
  netWorth: string;
  marketValue: string;
}

export interface IntegrityBodies {
  networth: NetWorthBody;
  networthParity: ParityBodies;
  /** `/networth/history?range=all`: the aggregate of the stored daily snapshots. */
  networthHistory: HistoryPoint[];
  portfolios: {
    id: string;
    summary: ValuationBody;
    parity: ParityBodies;
    /**
     * `/portfolios/:id/history?range=all`, in the portfolio's base currency. Only collected when
     * every portfolio is already in the display currency (otherwise summing needs a per-date FX
     * lookup per currency, which the report does not do); `null` when not collected.
     */
    history: HistoryPoint[] | null;
  }[];
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

function scopes(b: IntegrityBodies): { scope: string; v: ValuationBody; parity: ParityBodies }[] {
  return [
    { scope: "networth", v: b.networth, parity: b.networthParity },
    ...b.portfolios.map((p) => ({ scope: `portfolio:${p.id}`, v: p.summary, parity: p.parity })),
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

/**
 * Two endpoints are only comparable in the same currency; the parity endpoints use the
 * valuation's display currency, so a differing one means the pair is not comparable (abstain).
 */
function sameCurrency(a: string, b: string): boolean {
  return a === b;
}

/** The Savings page's net contributed is the gain summary's, on the same boundary. */
export function checkContributionParity(b: IntegrityBodies): Finding[] {
  return scopes(b).flatMap(({ scope, v, parity }) =>
    !v.gain || !sameCurrency(parity.contributions.displayCurrency, v.displayCurrency)
      ? []
      : compare(
          "CONTRIB_PARITY",
          scope,
          "contributions netContributed differs from gain.netContributed",
          new Decimal(v.gain.netContributed),
          new Decimal(parity.contributions.netContributed),
        ),
  );
}

/**
 * The trade log's realized total is the valuation's. The collector asks for the trade log's
 * default method (average cost), which is what the valuation's realized comes from; a `?method=`
 * (fifo/lifo) would make this comparison meaningless.
 */
export function checkRealizedParity(b: IntegrityBodies): Finding[] {
  return scopes(b).flatMap(({ scope, v, parity }) =>
    !sameCurrency(parity.trades.displayCurrency, v.displayCurrency)
      ? []
      : compare(
          "REALIZED_PARITY",
          scope,
          "trades totalRealized differs from the valuation's totalRealizedPnL",
          new Decimal(v.totalRealizedPnL),
          new Decimal(parity.trades.totalRealized),
        ),
  );
}

/**
 * What makes two anomalies the same one. `meta` is where same-code anomalies differ
 * (`negative_cash` per currency, `reconciliation_gap` per broker), so it is part of the key;
 * its keys are sorted so serialisation order cannot matter.
 */
const anomalyKey = (a: AnomalyBody): string => {
  const meta = Object.fromEntries(
    Object.entries(a.meta ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)),
  );
  return `${a.code ?? ""}|${a.transactionId ?? ""}|${a.instrumentId ?? ""}|${JSON.stringify(meta)}`;
};

/** /networth/anomalies is the union of every portfolio's own anomalies. */
export function checkAnomalyUnion(b: IntegrityBodies): Finding[] {
  const expected = new Set(
    b.portfolios.flatMap((p) => p.parity.anomalies.anomalies.map(anomalyKey)),
  );
  const actual = new Set(b.networthParity.anomalies.anomalies.map(anomalyKey));
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  if (missing.length === 0 && extra.length === 0) return [];
  return [
    {
      rule: "ANOMALY_UNION",
      scope: "networth",
      expected: `${expected.size} anomalies (the union of the portfolios')`,
      actual: `${actual.size} anomalies`,
      diff: `${missing.length} missing, ${extra.length} extra`,
      tolerance: "exact",
      message: "/networth/anomalies is not the union of the per-portfolio anomalies",
    },
  ];
}

const MAX_HISTORY_FINDINGS = 5;

/** Stored snapshots are one row per portfolio and day: a series must be strictly ascending. */
export function checkHistoryOrdered(b: IntegrityBodies): Finding[] {
  const series: { scope: string; points: HistoryPoint[] }[] = [
    { scope: "networth", points: b.networthHistory },
    ...b.portfolios.flatMap((p) =>
      p.history ? [{ scope: `portfolio:${p.id}`, points: p.history }] : [],
    ),
  ];
  const out: Finding[] = [];
  for (const { scope, points } of series) {
    for (let i = 1; i < points.length; i++) {
      if (points[i - 1]!.date < points[i]!.date) continue;
      out.push({
        rule: "HISTORY_ORDERED",
        scope,
        expected: `a date after ${points[i - 1]!.date}`,
        actual: points[i]!.date,
        diff: "n/a",
        tolerance: "n/a",
        message: "history dates are not strictly ascending (a duplicate or out-of-order point)",
      });
      break; // one finding per series: the rest follows from the same defect
    }
  }
  return out;
}

/**
 * The aggregate history at a date is the sum of that date's portfolio snapshots, each converted
 * at that date's rate. When every portfolio is already in the display currency no conversion
 * is involved, so the aggregate must equal the plain sum of the per-portfolio series (a
 * portfolio contributes only on the dates it has a snapshot). Abstains when any portfolio is in
 * another currency or its history was not collected.
 */
export function checkHistorySumsPortfolios(b: IntegrityBodies): Finding[] {
  if (b.portfolios.length === 0 || b.portfolios.some((p) => p.history === null)) return [];
  if (b.portfolios.some((p) => p.summary.displayCurrency !== b.networth.displayCurrency)) return [];

  const expected = new Map<string, { netWorth: Decimal; marketValue: Decimal }>();
  for (const p of b.portfolios) {
    for (const pt of p.history!) {
      const e = expected.get(pt.date) ?? { netWorth: new Decimal(0), marketValue: new Decimal(0) };
      e.netWorth = e.netWorth.add(pt.netWorth);
      e.marketValue = e.marketValue.add(pt.marketValue);
      expected.set(pt.date, e);
    }
  }
  const actual = new Map(b.networthHistory.map((pt) => [pt.date, pt]));
  const dates = [...new Set([...expected.keys(), ...actual.keys()])].sort();

  const out: Finding[] = [];
  // Capped by differing DATES (a date can carry a netWorth and a marketValue finding), so a
  // systematic defect does not bury the report in hundreds of rows.
  let datesListed = 0;
  let skipped = 0;
  const push = (f: Finding[]) => {
    if (f.length === 0) return;
    if (datesListed < MAX_HISTORY_FINDINGS) {
      out.push(...f);
      datesListed++;
    } else {
      skipped++;
    }
  };
  for (const date of dates) {
    const e = expected.get(date);
    const a = actual.get(date);
    if (!e || !a) {
      push([
        {
          rule: "HISTORY_SUMS_PORTFOLIOS",
          scope: "networth",
          expected: e ? "a point" : "no point",
          actual: a ? "a point" : "no point",
          diff: "n/a",
          tolerance: "n/a",
          message: `${date}: the aggregate and the per-portfolio histories disagree on whether this date exists`,
        },
      ]);
      continue;
    }
    push([
      ...compare(
        "HISTORY_SUMS_PORTFOLIOS",
        "networth",
        `${date}: aggregate netWorth differs from the sum of the portfolio histories`,
        e.netWorth,
        new Decimal(a.netWorth),
      ),
      ...compare(
        "HISTORY_SUMS_PORTFOLIOS",
        "networth",
        `${date}: aggregate marketValue differs from the sum of the portfolio histories`,
        e.marketValue,
        new Decimal(a.marketValue),
      ),
    ]);
  }
  if (skipped > 0) {
    out.push({
      rule: "HISTORY_SUMS_PORTFOLIOS",
      scope: "networth",
      expected: "no further differences",
      actual: `${skipped} more date(s) differ`,
      diff: String(skipped),
      tolerance: "n/a",
      message: `only the first ${MAX_HISTORY_FINDINGS} differing dates are listed`,
    });
  }
  return out;
}

/**
 * Keyed by `RuleId` so the compiler enforces that the ids in `RULE_IDS` and the rules that
 * actually run are the same set: a rule added here without an id (or the reverse) is a type
 * error, and `rulesRun` in the report cannot under-report.
 */
export const RULES: Record<RuleId, (b: IntegrityBodies) => Finding[]> = {
  NW_SUM_PORTFOLIOS: checkNetWorthSumsPortfolios,
  GAIN_MATCHES_TOTALS: checkGainMatchesTotals,
  HOLDINGS_SUM: checkHoldingsSum,
  NW_COMPOSITION: checkNetWorthComposition,
  FX_MISSING_DISCLOSED: checkFxMissingDisclosed,
  VALUED_AT_COST_NO_GAIN: checkValuedAtCostHasNoGain,
  CONTRIB_PARITY: checkContributionParity,
  REALIZED_PARITY: checkRealizedParity,
  ANOMALY_UNION: checkAnomalyUnion,
  HISTORY_ORDERED: checkHistoryOrdered,
  HISTORY_SUMS_PORTFOLIOS: checkHistorySumsPortfolios,
};

export function checkIntegrity(b: IntegrityBodies): Finding[] {
  return RULE_IDS.flatMap((id) => RULES[id](b));
}
