import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { allowanceUsageYTD, harvestSuggestions } from "../src/tax.js";
import { computePotsUsage } from "../src/tax-helpers.js";
import { computeTrades, mergeTradeLogs } from "../src/trade-log.js";
import type { Trade, TradeLog } from "../src/tax.js";

function makeTradeLog(overrides: Partial<TradeLog> = {}): TradeLog {
  return {
    displayCurrency: "EUR",
    method: "fifo",
    trades: [],
    totalRealized: "0",
    totalDividends: "0",
    totalReturn: "0",
    winRate: null,
    realizedByYear: [],
    dividendsByYear: [],
    bonusesByYear: [],
    ...overrides,
  };
}

function openTrade(instrumentId: string, unrealizedPnL: string): Trade {
  return {
    instrumentId,
    currency: "EUR",
    status: "open",
    entryDate: "2025-01-01",
    exitDate: null,
    holdingDays: 200,
    longTerm: false,
    quantity: "5",
    avgEntryPrice: "100",
    avgExitPrice: null,
    invested: "500",
    realizedPnL: "0",
    unrealizedPnL,
    dividends: "0",
    totalReturn: unrealizedPnL,
    totalReturnPct: 10,
    annualizedPct: null,
    legs: [],
  } as Trade;
}

function closedTrade(instrumentId: string, gain: string): Trade {
  return {
    ...openTrade(instrumentId, "0"),
    status: "closed",
    exitDate: "2025-06-01",
    realizedPnL: gain,
    legs: [
      {
        acqDate: "2025-01-01",
        sellDate: "2025-06-01",
        quantity: "5",
        cost: "500",
        proceeds: new Decimal(500).plus(gain).toString(),
        gain,
        holdingDays: 150,
        longTerm: false,
        taxYear: 2025,
        vorabCredit: "0",
      },
    ],
  } as Trade;
}

describe("C1: harvest suggestions skip §23 assets", () => {
  it("yields no suggestion for gold or crypto with an unrealized gain", () => {
    const log = makeTradeLog({
      trades: [openTrade("gold-1", "400"), openTrade("btc-1", "300"), openTrade("stock-1", "200")],
    });
    const result = harvestSuggestions({
      tradeLog: log,
      tfRates: {},
      allowanceAnnual: "1000",
      year: 2025,
      assetClasses: { "gold-1": "gold", "btc-1": "crypto", "stock-1": "equity" },
    });
    expect(result.map((s) => s.instrumentId)).toEqual(["stock-1"]);
  });
});

describe("C2: Teilfreistellung on fund distributions", () => {
  it("counts an equity-ETF distribution at 70% toward the general pot", () => {
    const log = makeTradeLog({
      dividendsByYear: [{ year: 2025, amount: "100", tax: "0" }],
      incomeByInstrumentYear: [{ instrumentId: "etf-1", year: 2025, amount: "100", tax: "0" }],
    });
    const u = allowanceUsageYTD({
      tradeLog: log,
      tfRates: { "etf-1": "0.30" },
      allowanceAnnual: "1000",
      year: 2025,
      assetClasses: { "etf-1": "etf" },
    });
    expect(u.generalPot.netGainLoss).toBe("70.00");
    expect(u.incomeYtd).toBe("70.00");
    expect(u.usedYtd).toBe("70.00");
  });

  it("leaves instrument-less income and non-fund dividends unadjusted", () => {
    const log = makeTradeLog({
      dividendsByYear: [{ year: 2025, amount: "180", tax: "20" }],
      incomeByInstrumentYear: [{ instrumentId: "etf-1", year: 2025, amount: "80", tax: "20" }],
    });
    // 100 gross from the ETF (-> 70) + 100 instrument-less interest (-> 100).
    const u = allowanceUsageYTD({
      tradeLog: log,
      tfRates: { "etf-1": "0.30" },
      allowanceAnnual: "1000",
      year: 2025,
    });
    expect(u.generalPot.netGainLoss).toBe("170.00");
  });

  it("computeTrades splits income per instrument and mergeTradeLogs sums it", () => {
    const tx = (instrumentId: string | null, type: string, price: string) =>
      ({
        id: `${type}-${instrumentId}-${price}`,
        instrumentId,
        type,
        quantity: "1",
        price,
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2025-03-01T00:00:00Z"),
        tax: "0",
      }) as never;
    const log = computeTrades({
      transactions: [tx("etf-1", "dividend", "10"), tx(null, "interest", "5")],
      prices: {},
      displayCurrency: "EUR",
    });
    expect(log.incomeByInstrumentYear).toEqual([
      { instrumentId: "etf-1", year: 2025, amount: "10", tax: "0" },
    ]);
    expect(log.dividendsByYear[0]?.amount).toBe("15");
    const merged = mergeTradeLogs([log, log], "EUR", "average");
    expect(merged.incomeByInstrumentYear).toEqual([
      { instrumentId: "etf-1", year: 2025, amount: "20", tax: "0" },
    ]);
  });
});

describe("C3: one-way loss-pot netting", () => {
  const cases: [string, string, string][] = [
    ["1000", "-400", "600"],
    ["-1000", "400", "400"],
    ["-400", "1000", "1000"],
    ["400", "-1000", "0"],
  ];
  it.each(cases)("stock %s / general %s -> taxable %s", (stock, general, taxable) => {
    const { stockUsed, generalUsed } = computePotsUsage(new Decimal(stock), new Decimal(general));
    expect(stockUsed.plus(generalUsed).toString()).toBe(taxable);
  });

  it.each(cases)(
    "allowanceUsageYTD end to end: stock %s / general %s",
    (stock, general, taxable) => {
      const log = makeTradeLog({
        trades: [closedTrade("stock-1", stock), closedTrade("fund-1", general)],
      });
      const u = allowanceUsageYTD({
        tradeLog: log,
        tfRates: {},
        allowanceAnnual: "5000",
        year: 2025,
        assetClasses: { "stock-1": "equity", "fund-1": "bond" },
      });
      expect(Number(u.usedYtd)).toBe(Number(taxable));
    },
  );

  it("applies the general carry-forward against the stock subtotal too", () => {
    // stock +1000, general +0 with 400 general carry-forward -> general net -400 -> 600.
    const r = computePotsUsage(new Decimal(1000), new Decimal(0), { general: "400" });
    expect(r.stockUsed.plus(r.generalUsed).toString()).toBe("600");
    // stock carry-forward never touches the general pot.
    const r2 = computePotsUsage(new Decimal(0), new Decimal(400), { stock: "1000" });
    expect(r2.stockUsed.plus(r2.generalUsed).toString()).toBe("400");
  });
});
