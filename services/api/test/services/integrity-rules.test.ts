import { describe, it, expect } from "vitest";
import {
  checkIntegrity,
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
    anomalies: { anomalies: [{ code: "zero_price", transactionId: "t1" }] },
  };
}

function bodies(): IntegrityBodies {
  return {
    networth: { ...valuation(), asOf: "2026-06-30T12:00:00.000Z" },
    networthParity: parity(),
    portfolios: [{ id: "p1", summary: valuation(), parity: parity() }],
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
    b.portfolios.push({ id: "p2", summary: valuation(), parity: parity() });
    b.portfolios[1]!.parity.anomalies.anomalies.push({ code: "oversell", transactionId: "t2" });
    b.networthParity.anomalies.anomalies = [
      { code: "oversell", transactionId: "t2" },
      { code: "zero_price", transactionId: "t1" },
    ];
    expect(rules(b)).not.toContain("ANOMALY_UNION");
  });
});
