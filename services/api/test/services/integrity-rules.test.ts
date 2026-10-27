import { describe, it, expect } from "vitest";
import {
  checkIntegrity,
  runIntegrity,
  type IntegrityBodies,
  type ParityBodies,
  type RuleId,
  type ValuationBody,
} from "../../src/services/integrity/index.js";

// Each rule must be able to fail: start from a consistent set of bodies (the numbers of the
// eur-basic ledger) and break one thing at a time.

function valuation(): ValuationBody {
  return {
    displayCurrency: "EUR",
    netWorth: "1260",
    totalCost: "960",
    totalMarketValue: "1260",
    totalUnrealizedPnL: "300",
    totalRealizedPnL: "140",
    totalIncome: "30",
    totalLiabilities: "0",
    cashTracked: false,
    cashDisplay: {},
    fxMissingCurrencies: [],
    holdings: [
      {
        instrumentId: "i1",
        currency: "EUR",
        costCurrency: "EUR",
        marketValueDisplay: "1260",
        costBasisDisplay: "960",
        unrealizedPnLDisplay: "300",
      },
    ],
    gain: {
      value: "1260",
      costOfOpen: "960",
      netContributed: "960",
      unrealized: "300",
      realized: "140",
      income: "30",
    },
  };
}

function parity(): ParityBodies {
  return {
    contributions: { displayCurrency: "EUR", netContributed: "960" },
    trades: { displayCurrency: "EUR", totalRealized: "140" },
    income: { displayCurrency: "EUR", lifetimeTotal: "30" },
    anomalies: { anomalies: [{ code: "zero_price", transactionId: "t1" }] },
  };
}

function bodies(): IntegrityBodies {
  return {
    networth: { ...valuation(), asOf: "2026-06-30T12:00:00.000Z" },
    networthParity: parity(),
    networthHistory: [
      { date: "2026-06-29", netWorth: "1200", marketValue: "1200" },
      { date: "2026-06-30", netWorth: "1260", marketValue: "1260" },
    ],
    portfolios: [
      {
        id: "p1",
        summary: valuation(),
        parity: parity(),
        history: [
          { date: "2026-06-29", netWorth: "1200", marketValue: "1200" },
          { date: "2026-06-30", netWorth: "1260", marketValue: "1260" },
        ],
      },
    ],
    fxToDisplay: {},
  };
}

const rules = (b: IntegrityBodies): RuleId[] => checkIntegrity(b).map((f) => f.rule);

describe("integrity rules", () => {
  it("report nothing on consistent bodies", () => {
    expect(checkIntegrity(bodies())).toEqual([]);
  });

  it("NW_SUM_PORTFOLIOS: networth differs from the summed portfolios", () => {
    const b = bodies();
    b.networth.netWorth = "1261";
    const f = checkIntegrity(b).find((x) => x.rule === "NW_SUM_PORTFOLIOS");
    expect(f).toMatchObject({ scope: "networth", expected: "1260", actual: "1261", diff: "1" });
  });

  it("NW_SUM_PORTFOLIOS: converts a foreign-currency portfolio at today's rate", () => {
    const b = bodies();
    b.portfolios.push({
      id: "p2",
      summary: { ...valuation(), displayCurrency: "USD", netWorth: "100" },
      parity: parity(),
      history: null,
    });
    b.fxToDisplay = { USD: "0.9" };
    b.networth.netWorth = "1350"; // 1260 + 100 × 0.9
    expect(rules(b)).not.toContain("NW_SUM_PORTFOLIOS");
    b.networth.netWorth = "1360"; // as if 1 USD = 1 EUR
    expect(rules(b)).toContain("NW_SUM_PORTFOLIOS");
  });

  it("NW_SUM_PORTFOLIOS: abstains when a currency has no rate (the app excludes it too)", () => {
    const b = bodies();
    b.portfolios.push({
      id: "p2",
      summary: { ...valuation(), displayCurrency: "CAD", netWorth: "100" },
      parity: parity(),
      history: null,
    });
    b.fxToDisplay = { CAD: null };
    b.networth.netWorth = "5";
    expect(rules(b)).not.toContain("NW_SUM_PORTFOLIOS");
  });

  it("GAIN_MATCHES_TOTALS: a gain field drifts from the response's own total", () => {
    const b = bodies();
    b.portfolios[0]!.summary.gain!.costOfOpen = "961";
    const f = checkIntegrity(b).find((x) => x.rule === "GAIN_MATCHES_TOTALS");
    expect(f).toMatchObject({ scope: "portfolio:p1", expected: "960", actual: "961" });
  });

  it("HOLDINGS_SUM: a total is not the sum of its holdings", () => {
    const b = bodies();
    b.networth.totalMarketValue = "1300";
    expect(rules(b)).toContain("HOLDINGS_SUM");
  });

  it("HOLDINGS_SUM: an fxMissing holding is out of every total", () => {
    const b = bodies();
    for (const v of [b.networth, b.portfolios[0]!.summary]) {
      v.fxMissingCurrencies = ["CAD"];
      v.holdings.push({
        instrumentId: "i2",
        currency: "CAD",
        costCurrency: "CAD",
        marketValueDisplay: null,
        costBasisDisplay: "30",
        unrealizedPnLDisplay: null,
        fxMissing: true,
      });
    }
    expect(checkIntegrity(b)).toEqual([]);
  });

  it("HOLDINGS_SUM: a merged holding flagged fxMissing that still carries value is counted", () => {
    // aggregatePortfolios OR-merges fxMissing but sums display values: one depot could convert.
    const b = bodies();
    b.networth.holdings[0]!.fxMissing = true;
    b.networth.fxMissingCurrencies = ["EUR"];
    expect(rules(b)).not.toContain("HOLDINGS_SUM");
  });

  it("NW_COMPOSITION: counted cash is missing from net worth", () => {
    const b = bodies();
    b.networth.cashTracked = true;
    b.networth.cashDisplay = { EUR: "50" };
    expect(rules(b)).toContain("NW_COMPOSITION");
  });

  it("NW_COMPOSITION: liabilities are subtracted", () => {
    const b = bodies();
    b.portfolios[0]!.summary.totalLiabilities = "10";
    expect(rules(b)).toContain("NW_COMPOSITION");
  });

  it("FX_MISSING_DISCLOSED: a flagged holding with an empty list, or the wrong currency", () => {
    const b = bodies();
    b.networth.holdings[0]!.fxMissing = true;
    expect(rules(b)).toContain("FX_MISSING_DISCLOSED");
    b.networth.fxMissingCurrencies = ["USD"];
    expect(rules(b)).toContain("FX_MISSING_DISCLOSED");
    b.networth.fxMissingCurrencies = ["EUR"];
    expect(rules(b)).not.toContain("FX_MISSING_DISCLOSED");
  });

  it("VALUED_AT_COST_NO_GAIN: a valued-at-cost holding reports a gain", () => {
    const b = bodies();
    b.networth.holdings[0]!.valuedAtCost = true;
    expect(rules(b)).toContain("VALUED_AT_COST_NO_GAIN");
    b.networth.holdings[0]!.unrealizedPnLDisplay = null;
    expect(rules(b)).not.toContain("VALUED_AT_COST_NO_GAIN");
  });

  it("CONTRIB_PARITY: the contributions page differs from gain.netContributed", () => {
    const b = bodies();
    b.portfolios[0]!.parity.contributions.netContributed = "961";
    const f = checkIntegrity(b).find((x) => x.rule === "CONTRIB_PARITY");
    expect(f).toMatchObject({ scope: "portfolio:p1", expected: "960", actual: "961" });
  });

  it("CONTRIB_PARITY / REALIZED_PARITY: abstain when the endpoint is in another currency", () => {
    const b = bodies();
    b.networthParity.contributions = { displayCurrency: "USD", netContributed: "1" };
    b.networthParity.trades = { displayCurrency: "USD", totalRealized: "1" };
    expect(rules(b)).not.toContain("CONTRIB_PARITY");
    expect(rules(b)).not.toContain("REALIZED_PARITY");
  });

  it("INCOME_PARITY: the Income page's lifetime total differs from the valuation's income", () => {
    const b = bodies();
    b.networthParity.income.lifetimeTotal = "18"; // e.g. interest and a tax debit left out (#1167)
    const f = checkIntegrity(b).find((x) => x.rule === "INCOME_PARITY");
    expect(f).toMatchObject({ scope: "networth", expected: "30", actual: "18" });
  });

  it("INCOME_PARITY: abstains when the endpoint is in another currency", () => {
    const b = bodies();
    b.networthParity.income = { displayCurrency: "USD", lifetimeTotal: "1" };
    expect(rules(b)).not.toContain("INCOME_PARITY");
    expect(runIntegrity(b).abstentions).toContainEqual({
      rule: "INCOME_PARITY",
      scope: "networth",
      reason: "currency_mismatch",
    });
  });

  it("REALIZED_PARITY: the trade log's realized total differs from the valuation's", () => {
    const b = bodies();
    b.networthParity.trades.totalRealized = "139";
    const f = checkIntegrity(b).find((x) => x.rule === "REALIZED_PARITY");
    expect(f).toMatchObject({ scope: "networth", expected: "140", actual: "139" });
  });

  it("ANOMALY_UNION: a portfolio anomaly missing from, or extra in, the aggregate", () => {
    const missing = bodies();
    missing.networthParity.anomalies.anomalies = [];
    expect(rules(missing)).toContain("ANOMALY_UNION");

    const extra = bodies();
    extra.networthParity.anomalies.anomalies.push({ code: "oversell", transactionId: "t9" });
    const f = checkIntegrity(extra).find((x) => x.rule === "ANOMALY_UNION");
    expect(f).toMatchObject({ scope: "networth", diff: "0 missing, 1 extra" });
  });

  it("ANOMALY_UNION: order and duplicates across portfolios do not matter", () => {
    const b = bodies();
    b.portfolios.push({ id: "p2", summary: valuation(), parity: parity(), history: null });
    b.portfolios[1]!.parity.anomalies.anomalies.push({ code: "oversell", transactionId: "t2" });
    b.networthParity.anomalies.anomalies = [
      { code: "oversell", transactionId: "t2" },
      { code: "zero_price", transactionId: "t1" },
    ];
    expect(rules(b)).not.toContain("ANOMALY_UNION");
  });

  it("ANOMALY_UNION: same-code anomalies that differ only in meta are kept apart", () => {
    // e.g. negative_cash per currency: dropping one of the two in the aggregate must be seen.
    const two = [
      { code: "negative_cash", meta: { currency: "EUR" } },
      { code: "negative_cash", meta: { currency: "USD" } },
    ];
    const b = bodies();
    b.portfolios[0]!.parity.anomalies.anomalies = two;
    b.networthParity.anomalies.anomalies = [two[0]!];
    const f = checkIntegrity(b).find((x) => x.rule === "ANOMALY_UNION");
    expect(f).toMatchObject({ diff: "1 missing, 0 extra" });
    // ... and meta key order is not part of the identity.
    b.networthParity.anomalies.anomalies = [
      { code: "negative_cash", meta: { currency: "EUR" } },
      { code: "negative_cash", meta: { currency: "USD" } },
    ];
    b.portfolios[0]!.parity.anomalies.anomalies = [
      { code: "negative_cash", meta: { currency: "USD" } },
      { code: "negative_cash", meta: { currency: "EUR" } },
    ];
    expect(rules(b)).not.toContain("ANOMALY_UNION");
  });

  it("HISTORY_ORDERED: a duplicate or out-of-order date, in the aggregate or one portfolio", () => {
    const dup = bodies();
    dup.networthHistory.push({ date: "2026-06-30", netWorth: "1", marketValue: "1" });
    const f = checkIntegrity(dup).find((x) => x.rule === "HISTORY_ORDERED");
    expect(f).toMatchObject({ scope: "networth", actual: "2026-06-30" });

    const back = bodies();
    back.portfolios[0]!.history![0] = { date: "2026-07-01", netWorth: "1", marketValue: "1" };
    expect(checkIntegrity(back).find((x) => x.rule === "HISTORY_ORDERED")).toMatchObject({
      scope: "portfolio:p1",
    });
  });

  it("HISTORY_SUMS_PORTFOLIOS: the aggregate differs from the sum of the portfolio series", () => {
    const b = bodies();
    b.networthHistory[1]!.netWorth = "1261";
    const f = checkIntegrity(b).find((x) => x.rule === "HISTORY_SUMS_PORTFOLIOS");
    expect(f).toMatchObject({ expected: "1260", actual: "1261", diff: "1" });
    expect(f!.message).toContain("2026-06-30");
  });

  it("HISTORY_SUMS_PORTFOLIOS: a portfolio counts from the date it first has a snapshot", () => {
    const b = bodies();
    b.portfolios.push({
      id: "p2",
      summary: valuation(),
      parity: parity(),
      history: [{ date: "2026-06-30", netWorth: "500", marketValue: "500" }],
    });
    b.networthHistory[1]!.netWorth = "1760"; // 1260 + 500 on the 30th only
    b.networthHistory[1]!.marketValue = "1760";
    expect(rules(b)).not.toContain("HISTORY_SUMS_PORTFOLIOS");
    b.networthHistory[0]!.netWorth = "1700"; // as if p2 also counted on the 29th
    expect(rules(b)).toContain("HISTORY_SUMS_PORTFOLIOS");
  });

  it("HISTORY_SUMS_PORTFOLIOS: a gap carries the portfolio's last netWorth forward, not a dip (#1172)", () => {
    // p2 has a row on the 29th only; on the 30th it has none, so its 500 is carried and the
    // aggregate is 1260 + 500. p1 has not started on the 29th, so it is not part of that point.
    const b = bodies();
    b.portfolios.push({
      id: "p2",
      summary: valuation(),
      parity: parity(),
      history: [{ date: "2026-06-29", netWorth: "500", marketValue: "500" }],
    });
    b.portfolios[0]!.history = [{ date: "2026-06-30", netWorth: "1260", marketValue: "1260" }];
    b.networthHistory = [
      { date: "2026-06-29", netWorth: "500", marketValue: "500" },
      { date: "2026-06-30", netWorth: "1760", marketValue: "1760" },
    ];
    b.networthHistory[1]!.netWorthCarried = true; // p2 was carried on the 30th
    expect(rules(b)).not.toContain("HISTORY_SUMS_PORTFOLIOS");
    b.networthHistory[1]!.netWorth = "1260"; // the old behaviour: the skipped portfolio drops out
    expect(rules(b)).toContain("HISTORY_SUMS_PORTFOLIOS");
  });

  it("HISTORY_SUMS_PORTFOLIOS: the carried flag must mark exactly the carried dates", () => {
    const b = bodies();
    b.portfolios.push({
      id: "p2",
      summary: valuation(),
      parity: parity(),
      history: [{ date: "2026-06-29", netWorth: "500", marketValue: "500" }],
    });
    b.portfolios[0]!.history = [{ date: "2026-06-30", netWorth: "1260", marketValue: "1260" }];
    b.networthHistory = [
      { date: "2026-06-29", netWorth: "500", marketValue: "500" },
      { date: "2026-06-30", netWorth: "1760", marketValue: "1760" },
    ];
    const missing = checkIntegrity(b).find((x) => x.rule === "HISTORY_SUMS_PORTFOLIOS");
    expect(missing).toMatchObject({ expected: "netWorthCarried", actual: "no netWorthCarried" });
    b.networthHistory[1]!.netWorthCarried = true;
    b.networthHistory[0]!.netWorthCarried = true; // flagged although nothing was carried
    const extra = checkIntegrity(b).find((x) => x.rule === "HISTORY_SUMS_PORTFOLIOS");
    expect(extra).toMatchObject({ expected: "no netWorthCarried", actual: "netWorthCarried" });
  });

  it("HISTORY_SUMS_PORTFOLIOS: a date only one side has is a finding", () => {
    const b = bodies();
    b.networthHistory.pop();
    const f = checkIntegrity(b).find((x) => x.rule === "HISTORY_SUMS_PORTFOLIOS");
    expect(f).toMatchObject({ expected: "a point", actual: "no point" });
  });

  it("HISTORY_SUMS_PORTFOLIOS: abstains with a foreign-currency portfolio or an uncollected series", () => {
    const foreign = bodies();
    foreign.portfolios[0]!.summary.displayCurrency = "USD";
    foreign.networthHistory[1]!.netWorth = "1";
    expect(rules(foreign)).not.toContain("HISTORY_SUMS_PORTFOLIOS");

    const missing = bodies();
    missing.portfolios[0]!.history = null;
    missing.networthHistory[1]!.netWorth = "1";
    expect(rules(missing)).not.toContain("HISTORY_SUMS_PORTFOLIOS");
  });

  it("HISTORY_SUMS_PORTFOLIOS: lists the first five differing dates in full, then a count of the rest", () => {
    const b = bodies();
    const dates = Array.from({ length: 9 }, (_, i) => `2026-05-${String(i + 10)}`);
    b.networthHistory = dates.map((date) => ({ date, netWorth: "1", marketValue: "1" }));
    b.portfolios[0]!.history = dates.map((date) => ({ date, netWorth: "2", marketValue: "2" }));
    const hist = checkIntegrity(b).filter((x) => x.rule === "HISTORY_SUMS_PORTFOLIOS");
    // 5 listed dates, then the count of the other 4 dates.
    expect(hist).toHaveLength(6);
    expect(hist.at(-1)!.actual).toBe("4 more date(s) differ");
  });

  it("reports no abstentions when every rule could compare everything", () => {
    expect(runIntegrity(bodies()).abstentions).toEqual([]);
  });

  it("an abstention is reported, not hidden: no FX rate, another currency, uncollected history", () => {
    const b = bodies();
    b.portfolios.push({
      id: "p2",
      summary: { ...valuation(), displayCurrency: "CAD" },
      parity: {
        ...parity(),
        contributions: { displayCurrency: "EUR", netContributed: "1" }, // not CAD: not comparable
        trades: { displayCurrency: "EUR", totalRealized: "1" },
        income: { displayCurrency: "EUR", lifetimeTotal: "1" },
      },
      history: null,
    });
    b.fxToDisplay = { CAD: null };
    const { findings, abstentions } = runIntegrity(b);
    expect(findings).toEqual([]);
    expect(abstentions).toEqual(
      expect.arrayContaining([
        { rule: "NW_SUM_PORTFOLIOS", scope: "networth", reason: "no_fx_rate" },
        { rule: "CONTRIB_PARITY", scope: "portfolio:p2", reason: "currency_mismatch" },
        { rule: "REALIZED_PARITY", scope: "portfolio:p2", reason: "currency_mismatch" },
        { rule: "INCOME_PARITY", scope: "portfolio:p2", reason: "currency_mismatch" },
        // The foreign currency, not the (consequent) missing series, is the reason given: by
        // both history rules, so one cause is not explained two ways.
        { rule: "HISTORY_SUMS_PORTFOLIOS", scope: "networth", reason: "foreign_currency" },
        { rule: "HISTORY_ORDERED", scope: "portfolio:p2", reason: "foreign_currency" },
      ]),
    );
  });

  it("an uncollected series in an all-display-currency account is its own reason", () => {
    const b = bodies();
    b.portfolios[0]!.history = null;
    expect(runIntegrity(b).abstentions).toEqual([
      { rule: "HISTORY_ORDERED", scope: "portfolio:p1", reason: "history_not_collected" },
      { rule: "HISTORY_SUMS_PORTFOLIOS", scope: "networth", reason: "history_not_collected" },
    ]);
  });

  it("a missing gain block abstains on the contribution parity instead of passing it", () => {
    const b = bodies();
    delete b.portfolios[0]!.summary.gain;
    const { abstentions } = runIntegrity(b);
    // Both rules that need the gain block say they skipped the scope, not just one of them.
    expect(abstentions).toContainEqual({
      rule: "CONTRIB_PARITY",
      scope: "portfolio:p1",
      reason: "not_available",
    });
    expect(abstentions).toContainEqual({
      rule: "GAIN_MATCHES_TOTALS",
      scope: "portfolio:p1",
      reason: "not_available",
    });
  });

  it("checkIntegrity returns exactly the findings of runIntegrity", () => {
    const b = bodies();
    b.networth.netWorth = "1261";
    expect(checkIntegrity(b)).toEqual(runIntegrity(b).findings);
  });
});
