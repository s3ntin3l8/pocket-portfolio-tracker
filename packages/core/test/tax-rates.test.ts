import { describe, it, expect, vi } from "vitest";
import {
  computeTrades,
  effectiveCapitalGainsTaxRate,
  basiszinsFor,
  defaultPartialExemptionRate,
  estimateVorabpauschale,
  vorabpauschalePerUnit,
  vorabZuflussDate,
  BASISZINS_BY_YEAR,
  allowanceUsageYTD,
  type CoreTransaction,
} from "../src/index.js";
import { heldMoreThanOneYear } from "../src/trade-log/helpers.js";

describe("defaultPartialExemptionRate", () => {
  it("is 30% for equity funds, 15% for mixed funds, none otherwise", () => {
    expect(defaultPartialExemptionRate("etf")).toBe("0.30");
    expect(defaultPartialExemptionRate("mutual_fund")).toBe("0.15");
    expect(defaultPartialExemptionRate("equity")).toBeNull();
    expect(defaultPartialExemptionRate("bond")).toBeNull();
  });
});

describe("effectiveCapitalGainsTaxRate", () => {
  it("defaults to Abgeltungsteuer + Soli (26.375%)", () => {
    expect(effectiveCapitalGainsTaxRate({})).toBe("0.26375");
    expect(effectiveCapitalGainsTaxRate({ capitalGainsTaxRate: null, churchTax: false })).toBe(
      "0.26375",
    );
  });
  it("derives the rate from church tax when no explicit rate is set", () => {
    // e = 0.25 / 1.0225; total = e * (1 + 0.055 + 0.09)
    expect(effectiveCapitalGainsTaxRate({ churchTax: true })).toBe("0.279951");
    expect(effectiveCapitalGainsTaxRate({ churchTax: true, churchTaxRate: "0.08" })).toBe(
      "0.278186",
    );
  });
  it("lets an explicit rate win", () => {
    expect(effectiveCapitalGainsTaxRate({ capitalGainsTaxRate: "0.30", churchTax: true })).toBe(
      "0.30",
    );
  });
  it("is the allowance computation's default rate", () => {
    const u = allowanceUsageYTD({
      tradeLog: {
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
      },
      tfRates: {},
      allowanceAnnual: "1000",
      year: 2025,
    });
    expect(u.taxRate).toBe("0.26375");
  });
});

describe("Basiszins table / Vorabpauschale estimate", () => {
  it("has the official values for 2023-2026", () => {
    expect(BASISZINS_BY_YEAR).toMatchObject({
      2023: "0.0255",
      2024: "0.0229",
      2025: "0.0253",
      2026: "0.0320",
    });
  });
  it("warns and returns null for an unknown year instead of guessing", () => {
    const warn = vi.fn();
    expect(basiszinsFor(2031, warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(
      estimateVorabpauschale({
        year: 2031,
        valueStartOfYear: "1000",
        valueEndOfYear: "1100",
        distributions: "0",
      }),
    ).toBeNull();
  });
  it("estimates value x Basiszins x 70%, capped by the actual increase", () => {
    // 10,000 x 2.53% x 0.7 = 177.10
    expect(
      estimateVorabpauschale({
        year: 2025,
        valueStartOfYear: "10000",
        valueEndOfYear: "11000",
        distributions: "0",
      }),
    ).toBe("177.10");
    // Increase of only 100 caps it.
    expect(
      estimateVorabpauschale({
        year: 2025,
        valueStartOfYear: "10000",
        valueEndOfYear: "10100",
        distributions: "0",
      }),
    ).toBe("100.00");
    // Loss year: nothing; distributions reduce it.
    expect(
      estimateVorabpauschale({
        year: 2025,
        valueStartOfYear: "10000",
        valueEndOfYear: "9000",
        distributions: "0",
      }),
    ).toBe("0.00");
    expect(
      estimateVorabpauschale({
        year: 2025,
        valueStartOfYear: "10000",
        valueEndOfYear: "11000",
        distributions: "50",
      }),
    ).toBe("127.10");
  });
});

describe("§18 Abs. 2 acquisition-year reduction", () => {
  it("scales the Vorabpauschale itself by monthsHeld/12, after the cap", () => {
    // Full-year amount 177.10 (cap not binding); bought in July => 6 months => half.
    expect(
      estimateVorabpauschale({
        year: 2025,
        valueStartOfYear: "10000",
        valueEndOfYear: "11000",
        distributions: "0",
        monthsHeld: 6,
      }),
    ).toBe("88.55");
    // The cap binds on the full-year increase (100), then the reduction applies: 100 x 6/12.
    expect(
      estimateVorabpauschale({
        year: 2025,
        valueStartOfYear: "10000",
        valueEndOfYear: "10100",
        distributions: "0",
        monthsHeld: 6,
      }),
    ).toBe("50.00");
  });

  it("clamps monthsHeld to 0..12 and treats 0 as no Vorabpauschale", () => {
    const base = {
      year: 2025,
      valueStartOfYear: "10000",
      valueEndOfYear: "11000",
      distributions: "0",
    };
    expect(estimateVorabpauschale({ ...base, monthsHeld: 99 })).toBe("177.10");
    expect(estimateVorabpauschale({ ...base, monthsHeld: 0 })).toBe("0.00");
  });

  it("vorabpauschalePerUnit is unrounded and null for an unknown year", () => {
    const warn = vi.fn();
    expect(
      vorabpauschalePerUnit({
        year: 2025,
        priceStartOfYear: "100",
        priceEndOfYear: "110",
        distributionsPerUnit: "0",
      })?.toString(),
    ).toBe("1.771");
    expect(
      vorabpauschalePerUnit({
        year: 2031,
        priceStartOfYear: "100",
        priceEndOfYear: "110",
        distributionsPerUnit: "0",
        warn,
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("vorabZuflussDate (§18 Abs. 3 InvStG)", () => {
  it("is the first working day of the following year, skipping weekends", () => {
    expect(vorabZuflussDate(2023).toISOString()).toBe("2024-01-02T00:00:00.000Z"); // Tue
    expect(vorabZuflussDate(2024).toISOString()).toBe("2025-01-02T00:00:00.000Z"); // Thu
    expect(vorabZuflussDate(2025).toISOString()).toBe("2026-01-02T00:00:00.000Z"); // Fri
    expect(vorabZuflussDate(2026).toISOString()).toBe("2027-01-04T00:00:00.000Z"); // Sat -> Mon
  });
});

describe("heldMoreThanOneYear (§23 EStG)", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  it("is false on the anniversary and true the day after", () => {
    expect(heldMoreThanOneYear(d("2023-03-10"), d("2024-03-10"))).toBe(false);
    expect(heldMoreThanOneYear(d("2023-03-10"), d("2024-03-11"))).toBe(true);
  });
  it("is leap-year safe (365 days is not a year across 29 Feb)", () => {
    // 2023-03-01 -> 2024-02-29 is 365 days but not yet a year; 2024-03-01 is not > 1y either.
    expect(heldMoreThanOneYear(d("2023-03-01"), d("2024-02-29"))).toBe(false);
    // 2024-01-01 -> 2024-12-31 (365 days, leap year) is still within one year.
    expect(heldMoreThanOneYear(d("2023-01-01"), d("2024-01-01"))).toBe(false);
    expect(heldMoreThanOneYear(d("2024-02-29"), d("2025-02-28"))).toBe(false);
    expect(heldMoreThanOneYear(d("2024-02-29"), d("2025-03-01"))).toBe(true);
  });
});

describe("average-method long-term flag uses per-lot dates", () => {
  const tx = (p: Partial<CoreTransaction>): CoreTransaction => ({
    instrumentId: "gold-1",
    type: "buy",
    quantity: "1",
    price: "100",
    fees: "0",
    currency: "EUR",
    executedAt: new Date("2020-01-01T00:00:00Z"),
    ...p,
  });
  const run = (txns: CoreTransaction[]) =>
    computeTrades({
      transactions: txns,
      prices: {},
      displayCurrency: "EUR",
      method: "average",
      instruments: { "gold-1": { assetClass: "gold" } },
    });

  it("a recent top-up does not inherit the first lot's long-term status", () => {
    const log = run([
      tx({}),
      tx({ executedAt: new Date("2022-05-01T00:00:00Z") }),
      tx({
        type: "sell",
        quantity: "2",
        price: "150",
        executedAt: new Date("2022-08-01T00:00:00Z"),
      }),
    ]);
    expect(log.trades[0]?.legs[0]?.longTerm).toBe(false);
    expect(log.trades[0]?.longTerm).toBe(false);
  });

  it("is long-term when every consumed lot is older than a year", () => {
    const log = run([
      tx({}),
      tx({ executedAt: new Date("2020-05-01T00:00:00Z") }),
      tx({
        type: "sell",
        quantity: "2",
        price: "150",
        executedAt: new Date("2022-08-01T00:00:00Z"),
      }),
    ]);
    expect(log.trades[0]?.legs[0]?.longTerm).toBe(true);
    expect(log.trades[0]?.longTerm).toBe(true);
  });
});
