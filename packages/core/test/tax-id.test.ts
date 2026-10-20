import { describe, it, expect } from "vitest";
import {
  indonesianFinalTax,
  mergeIndonesianFinalTax,
  classifyIdIncome,
  idIncomeTaxRate,
  idIncomeWithheldAtSource,
  ID_SALES_TAX_RATE,
  ID_DOMESTIC_DIVIDEND_TAX_RATE,
  ID_BOND_INTEREST_TAX_RATE,
  ID_DEPOSIT_INTEREST_TAX_RATE,
  ID_FUND_DISTRIBUTION_TAX_RATE,
  ID_DEPOSIT_EXEMPT_BALANCE_IDR,
  ID_BOND_RATE_TABLE,
  idRateOn,
  isIndonesianInstrument,
  idCashBalancesBefore,
  idCashBalancesAtPayments,
  idDepositBalanceIdr,
  idDepositInterestExempt,
  type IdIncomeInput,
} from "../src/tax-id.js";
import type { CoreTransaction } from "../src/types.js";
import type { FxRateFn } from "../src/networth.js";

/** One income row of 2026 in IDR, no recorded withholding unless given. */
const row = (o: Partial<IdIncomeInput> & Pick<IdIncomeInput, "symbol" | "category" | "gross">) =>
  ({ currency: "IDR", year: 2026, recordedTax: "0", ...o }) satisfies IdIncomeInput;

const empty = { year: 2026, disposals: [], income: [], byYear: [] };

describe("Indonesian final-tax rates", () => {
  it("has one rate per income type", () => {
    expect(ID_SALES_TAX_RATE).toBe("0.001");
    expect(ID_DOMESTIC_DIVIDEND_TAX_RATE).toBe("0.10");
    expect(ID_BOND_INTEREST_TAX_RATE).toBe("0.10");
    expect(ID_DEPOSIT_INTEREST_TAX_RATE).toBe("0.20");
    expect(ID_FUND_DISTRIBUTION_TAX_RATE).toBe("0");
    expect(ID_DEPOSIT_EXEMPT_BALANCE_IDR).toBe("7500000");
    expect(idIncomeTaxRate("domestic_dividend")).toBe("0.10");
    expect(idIncomeTaxRate("bond_interest")).toBe("0.10");
    expect(idIncomeTaxRate("bond_discount")).toBe("0.10");
    expect(idIncomeTaxRate("deposit_interest")).toBe("0.20");
    expect(idIncomeTaxRate("fund_distribution")).toBe("0");
    expect(idIncomeTaxRate("foreign")).toBeNull();
  });

  it("picks the latest bond rate whose start is on or before the sale date", () => {
    expect(idRateOn(ID_BOND_RATE_TABLE, "2021-08-29")).toBe("0.15");
    expect(idRateOn(ID_BOND_RATE_TABLE, "2021-08-30")).toBe("0.10");
    expect(idRateOn(ID_BOND_RATE_TABLE, "2026-01-01")).toBe("0.10");
  });

  it("marks bond interest, bond discount and deposit interest as withheld at source", () => {
    expect(idIncomeWithheldAtSource("bond_interest")).toBe(true);
    expect(idIncomeWithheldAtSource("bond_discount")).toBe(true);
    expect(idIncomeWithheldAtSource("deposit_interest")).toBe(true);
    expect(idIncomeWithheldAtSource("domestic_dividend")).toBe(false);
    expect(idIncomeWithheldAtSource("fund_distribution")).toBe(false);
    expect(idIncomeWithheldAtSource("foreign")).toBe(false);
  });
});

describe("classifyIdIncome", () => {
  const idx = (assetClass: string, isin: string | null = null) => ({
    market: "IDX",
    assetClass,
    isin,
  });

  it("an IDX stock's dividend is a domestic dividend", () => {
    expect(classifyIdIncome({ type: "dividend", currency: "IDR", instrument: idx("equity") })).toBe(
      "domestic_dividend",
    );
  });

  it("a coupon or interest on an Indonesian bond is bond interest", () => {
    expect(classifyIdIncome({ type: "coupon", currency: "IDR", instrument: idx("bond") })).toBe(
      "bond_interest",
    );
    expect(classifyIdIncome({ type: "interest", currency: "IDR", instrument: idx("bond") })).toBe(
      "bond_interest",
    );
  });

  it("IDR cash interest (no instrument) is bank interest", () => {
    expect(classifyIdIncome({ type: "interest", currency: "IDR", instrument: null })).toBe(
      "deposit_interest",
    );
    expect(classifyIdIncome({ type: "interest", currency: "idr" })).toBe("deposit_interest");
  });

  it("cash interest in another currency is foreign", () => {
    expect(classifyIdIncome({ type: "interest", currency: "EUR", instrument: null })).toBe(
      "foreign",
    );
    expect(classifyIdIncome({ type: "interest", currency: "USD" })).toBe("foreign");
  });

  it("a reksa dana or IDX ETF distribution is a fund distribution", () => {
    expect(
      classifyIdIncome({ type: "dividend", currency: "IDR", instrument: idx("mutual_fund") }),
    ).toBe("fund_distribution");
    expect(classifyIdIncome({ type: "dividend", currency: "IDR", instrument: idx("etf") })).toBe(
      "fund_distribution",
    );
  });

  it("decides domestic by the instrument, not the transaction currency", () => {
    // A US stock paying in IDR is still foreign; an IDX stock paying in USD is domestic.
    expect(
      classifyIdIncome({
        type: "dividend",
        currency: "IDR",
        instrument: { market: "US", assetClass: "equity" },
      }),
    ).toBe("foreign");
    expect(classifyIdIncome({ type: "dividend", currency: "USD", instrument: idx("equity") })).toBe(
      "domestic_dividend",
    );
    // An IDR coupon on a bond that isn't Indonesian (neither IDX nor an ID ISIN).
    expect(
      classifyIdIncome({
        type: "coupon",
        currency: "IDR",
        instrument: { market: "XETRA", assetClass: "bond", isin: "XS0000000001" },
      }),
    ).toBe("foreign");
  });

  it("an Indonesian ISIN marks the instrument domestic outside the IDX market", () => {
    expect(
      classifyIdIncome({
        type: "coupon",
        currency: "IDR",
        instrument: { market: "OTC", assetClass: "bond", isin: "IDA000123456" },
      }),
    ).toBe("bond_interest");
    expect(
      classifyIdIncome({
        type: "dividend",
        currency: "IDR",
        instrument: { market: "US", assetClass: "equity", isin: "US0378331005" },
      }),
    ).toBe("foreign");
  });

  it("treats SBN, KSEI, IBPA and PHEI as Indonesian for income, not as a share venue", () => {
    for (const market of ["SBN", "KSEI", "IBPA", "PHEI", "sbn"]) {
      expect(isIndonesianInstrument({ market, isin: null })).toBe(true);
      expect(
        classifyIdIncome({
          type: "coupon",
          currency: "IDR",
          instrument: { market, assetClass: "bond", isin: null },
        }),
      ).toBe("bond_interest");
    }
    expect(isIndonesianInstrument({ market: "XETRA", isin: "DE000BASF111" })).toBe(false);
  });

  it("an instrument-less IDR dividend or coupon keeps its type's category", () => {
    expect(classifyIdIncome({ type: "dividend", currency: "IDR" })).toBe("domestic_dividend");
    expect(classifyIdIncome({ type: "coupon", currency: "IDR" })).toBe("bond_interest");
  });

  describe("cash interest by the portfolio's country", () => {
    it("is bank interest in any currency when the portfolio is in Indonesia", () => {
      // A USD deposit at an Indonesian bank: 20% final like an IDR one (PMK 212/2018).
      expect(
        classifyIdIncome({
          type: "interest",
          currency: "USD",
          instrument: null,
          portfolioCountry: "ID",
        }),
      ).toBe("deposit_interest");
      expect(classifyIdIncome({ type: "interest", currency: "IDR", portfolioCountry: "ID" })).toBe(
        "deposit_interest",
      );
      expect(classifyIdIncome({ type: "interest", currency: "EUR", portfolioCountry: "id" })).toBe(
        "deposit_interest",
      );
    });

    it("is foreign in any currency when the portfolio is in another country", () => {
      // IDR held at a German bank is still foreign-source interest.
      expect(
        classifyIdIncome({
          type: "interest",
          currency: "IDR",
          instrument: null,
          portfolioCountry: "DE",
        }),
      ).toBe("foreign");
      expect(classifyIdIncome({ type: "interest", currency: "USD", portfolioCountry: "SG" })).toBe(
        "foreign",
      );
    });

    it("falls back to the currency when the country is unset", () => {
      for (const portfolioCountry of [null, undefined, ""]) {
        expect(classifyIdIncome({ type: "interest", currency: "IDR", portfolioCountry })).toBe(
          "deposit_interest",
        );
        expect(classifyIdIncome({ type: "interest", currency: "USD", portfolioCountry })).toBe(
          "foreign",
        );
      }
    });

    it("does not change how an instrument's income is classified", () => {
      // An IDX stock held through a German depot is still an Indonesian dividend...
      expect(
        classifyIdIncome({
          type: "dividend",
          currency: "IDR",
          instrument: idx("equity"),
          portfolioCountry: "DE",
        }),
      ).toBe("domestic_dividend");
      // ...and a US stock held at an Indonesian broker is still foreign.
      expect(
        classifyIdIncome({
          type: "dividend",
          currency: "USD",
          instrument: { market: "US", assetClass: "equity", isin: "US0378331005" },
          portfolioCountry: "ID",
        }),
      ).toBe("foreign");
    });
  });
});

describe("indonesianFinalTax", () => {
  it("returns all zeros for an empty input", () => {
    const result = indonesianFinalTax(empty);
    expect(result.disposals).toEqual([]);
    expect(result.totalProceeds).toBe("0.00");
    expect(result.totalSalesTax).toBe("0.00");
    expect(result.income).toEqual([]);
    expect(result.incomeByCategory).toEqual([]);
    expect(result.totalIncomeGross).toBe("0.00");
    expect(result.totalIncomeTax).toBe("0.00");
    expect(result.totalIncomeNet).toBe("0.00");
    expect(result.foreignIncomeGross).toBe("0.00");
    expect(result.foreignTaxWithheld).toBe("0.00");
    expect(result.estimatedTax).toBe("0.00");
    expect(result.taxWithheldAtSource).toBe("0.00");
    expect(result.taxToSelfPay).toBe("0.00");
    expect(result.byYear).toEqual([]);
  });

  it("computes 0.1% sales tax per disposal and totals, withheld at source", () => {
    const result = indonesianFinalTax({
      ...empty,
      disposals: [
        { symbol: "BBNI", when: "2026-05-18", proceeds: "1640000" },
        { symbol: "ARTO", when: "2026-05-02", proceeds: "2490000" },
        { symbol: "TLKM", when: "2026-06-24", proceeds: "602000" },
      ],
    });

    expect(result.disposals).toEqual([
      { symbol: "BBNI", when: "2026-05-18", proceeds: "1640000", tax: "1640.00" },
      { symbol: "ARTO", when: "2026-05-02", proceeds: "2490000", tax: "2490.00" },
      { symbol: "TLKM", when: "2026-06-24", proceeds: "602000", tax: "602.00" },
    ]);
    expect(result.totalProceeds).toBe("4732000.00");
    expect(result.totalSalesTax).toBe("4732.00");
    expect(result.estimatedTax).toBe("4732.00");
    expect(result.taxWithheldAtSource).toBe("4732.00");
    expect(result.taxToSelfPay).toBe("0.00");
  });

  it("uses a decided sales tax instead of proceeds × 0.1%, including in byYear", () => {
    const result = indonesianFinalTax({
      ...empty,
      disposals: [
        { symbol: "BBNI", when: "2026-05-18", proceeds: "1500", tax: "5", taxBasis: "recorded" },
      ],
      byYear: [{ year: 2026, proceeds: "1500", salesTax: "5", realized: "100" }],
    });
    expect(result.disposals).toEqual([
      {
        symbol: "BBNI",
        when: "2026-05-18",
        proceeds: "1500",
        tax: "5.00",
        taxBasis: "recorded",
      },
    ]);
    expect(result.totalSalesTax).toBe("5.00");
    expect(result.estimatedTax).toBe("5.00");
    expect(result.taxWithheldAtSource).toBe("5.00");
    expect(result.byYear).toEqual([
      expect.objectContaining({ year: 2026, tax: "5.00", realized: "100.00" }),
    ]);
  });

  it("domestic dividend: 10% of gross, self-paid, a recorded tax ignored", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [
        row({ symbol: "BBCA", category: "domestic_dividend", gross: "420000" }),
        // Nothing is withheld for a resident individual: a recorded figure is not
        // Indonesian tax, so the 10% still applies to the gross.
        row({
          symbol: "TLKM",
          category: "domestic_dividend",
          gross: "168000",
          recordedTax: "5000",
        }),
      ],
    });
    expect(result.income).toEqual([
      expect.objectContaining({
        symbol: "BBCA",
        category: "domestic_dividend",
        rate: "0.10",
        gross: "420000.00",
        tax: "42000.00",
        net: "378000.00",
        withheldAtSource: false,
        taxBasis: "estimated",
        foreignTaxWithheld: null,
      }),
      expect.objectContaining({ symbol: "TLKM", tax: "16800.00" }),
    ]);
    expect(result.totalIncomeTax).toBe("58800.00");
    expect(result.taxToSelfPay).toBe("58800.00");
    expect(result.taxWithheldAtSource).toBe("0.00");
  });

  it("bond interest: 10% final withheld, a recorded withholding wins per transaction", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [
        row({ instrumentId: "ori", symbol: "ORI023", category: "bond_interest", gross: "312000" }),
        // A pre-September-2021 coupon withheld at the old 15%: the recorded figure is used.
        row({
          instrumentId: "ori",
          symbol: "ORI023",
          category: "bond_interest",
          gross: "100000",
          recordedTax: "15000",
        }),
      ],
    });
    expect(result.income).toEqual([
      expect.objectContaining({
        instrumentId: "ori",
        category: "bond_interest",
        rate: "0.10",
        gross: "412000.00",
        tax: "46200.00", // 31,200 (10%) + 15,000 recorded
        net: "365800.00",
        withheldAtSource: true,
        taxBasis: "mixed",
      }),
    ]);
    expect(result.taxWithheldAtSource).toBe("46200.00");
    expect(result.taxToSelfPay).toBe("0.00");
  });

  it("deposit interest: 20% final withheld, the recorded withholding preferred", () => {
    const estimated = indonesianFinalTax({
      ...empty,
      income: [row({ symbol: "interest", category: "deposit_interest", gross: "250000" })],
    });
    expect(estimated.income[0]).toMatchObject({
      rate: "0.20",
      tax: "50000.00",
      net: "200000.00",
      withheldAtSource: true,
      taxBasis: "estimated",
    });
    const recorded = indonesianFinalTax({
      ...empty,
      income: [
        row({
          symbol: "interest",
          category: "deposit_interest",
          gross: "250000",
          recordedTax: "40000",
        }),
      ],
    });
    expect(recorded.income[0]).toMatchObject({ tax: "40000.00", taxBasis: "recorded" });
    expect(recorded.taxWithheldAtSource).toBe("40000.00");
  });

  it("fund distribution: not a tax object, 0 tax and no tax basis", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [row({ symbol: "RDSAHAM", category: "fund_distribution", gross: "300000" })],
    });
    expect(result.income[0]).toMatchObject({
      rate: "0",
      gross: "300000.00",
      tax: "0.00",
      net: "300000.00",
      taxBasis: null,
    });
    expect(result.totalIncomeGross).toBe("300000.00");
    expect(result.estimatedTax).toBe("0.00");
  });

  it("foreign income: reported apart with its creditable withholding, never in the estimate", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [
        row({
          symbol: "AAPL",
          category: "foreign",
          gross: "1840000",
          recordedTax: "240000",
        }),
        row({ symbol: "interest", category: "foreign", gross: "170000" }),
        row({ symbol: "BBCA", category: "domestic_dividend", gross: "1000000" }),
      ],
    });
    expect(result.income.find((r) => r.symbol === "AAPL")).toEqual(
      expect.objectContaining({
        rate: null,
        tax: null,
        net: null,
        taxBasis: null,
        withheldAtSource: false,
        foreignTaxWithheld: "240000.00",
      }),
    );
    expect(result.foreignIncomeGross).toBe("2010000.00");
    expect(result.foreignTaxWithheld).toBe("240000.00");
    expect(result.totalIncomeGross).toBe("1000000.00");
    expect(result.estimatedTax).toBe("100000.00");
    expect(result.incomeByCategory).toEqual([
      {
        category: "domestic_dividend",
        rate: "0.10",
        gross: "1000000.00",
        exemptGross: "0.00",
        tax: "100000.00",
        withheldAtSource: false,
      },
      {
        category: "foreign",
        rate: null,
        gross: "2010000.00",
        exemptGross: "0.00",
        tax: null,
        withheldAtSource: false,
      },
    ]);
  });

  it("keeps cash income apart per currency and passes its source through", () => {
    // Both reported in IDR with the same label stem: only the cash source tells them apart.
    const result = indonesianFinalTax({
      ...empty,
      income: [
        row({
          symbol: "Cash interest",
          cashSource: { type: "interest", currency: "EUR" },
          category: "foreign",
          gross: "170000",
        }),
        row({
          symbol: "Cash interest",
          cashSource: { type: "interest", currency: "USD" },
          category: "foreign",
          gross: "16000",
        }),
        row({
          symbol: "Cash interest",
          cashSource: { type: "interest", currency: "EUR" },
          category: "foreign",
          gross: "30000",
        }),
      ],
    });
    expect(result.income).toHaveLength(2);
    expect(result.income.find((r) => r.cashSource?.currency === "EUR")).toMatchObject({
      cashSource: { type: "interest", currency: "EUR" },
      gross: "200000.00",
    });
    expect(result.income.find((r) => r.cashSource?.currency === "USD")?.gross).toBe("16000.00");
  });

  it("leaves cashSource off instrument rows", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [row({ symbol: "BBCA", category: "domestic_dividend", gross: "100" })],
    });
    expect(result.income[0]).not.toHaveProperty("cashSource");
  });

  it("estimatedTax = sales tax + Indonesian income tax, split into withheld and self-paid", () => {
    const result = indonesianFinalTax({
      ...empty,
      disposals: [{ symbol: "BBNI", when: "2026-05-18", proceeds: "1000000" }],
      income: [
        row({ symbol: "BBCA", category: "domestic_dividend", gross: "500000" }),
        row({ symbol: "ORI", category: "bond_interest", gross: "200000" }),
        row({ symbol: "interest", category: "deposit_interest", gross: "100000" }),
        row({ symbol: "VOO", category: "foreign", gross: "999999" }),
      ],
    });
    // 1,000 sales + 50,000 dividend + 20,000 bond + 20,000 deposit.
    expect(result.estimatedTax).toBe("91000.00");
    expect(result.taxWithheldAtSource).toBe("41000.00");
    expect(result.taxToSelfPay).toBe("50000.00");
    expect(result.incomeByCategory.map((c) => c.category)).toEqual([
      "domestic_dividend",
      "bond_interest",
      "deposit_interest",
      "foreign",
    ]);
  });

  it("rounds fractional-rupiah tax to 2 decimal places without losing precision", () => {
    const result = indonesianFinalTax({
      ...empty,
      disposals: [{ symbol: "X", when: "2026-01-01", proceeds: "333.33" }],
      income: [row({ symbol: "Y", category: "domestic_dividend", gross: "10.005" })],
    });
    // 333.33 * 0.001 = 0.33333 -> 0.33
    expect(result.disposals[0]!.tax).toBe("0.33");
    // 10.005 * 0.10 = 1.0005 -> 1.00; net from the unrounded tax (9.0045) -> 9.00.
    expect(result.income[0]!.tax).toBe("1.00");
    expect(result.income[0]!.net).toBe("9.00");
  });

  it("builds a by-year rollup with each year's income at its category's rate, newest first", () => {
    const result = indonesianFinalTax({
      year: 2026,
      disposals: [],
      income: [
        row({ symbol: "BBCA", category: "domestic_dividend", gross: "1000000", year: 2024 }),
        row({ symbol: "interest", category: "deposit_interest", gross: "500000", year: 2025 }),
        row({ symbol: "AAPL", category: "foreign", gross: "700000", year: 2025 }),
        row({ symbol: "ORI", category: "bond_interest", gross: "300000", year: 2026 }),
      ],
      byYear: [
        { year: 2024, proceeds: "760000", realized: "760000" },
        { year: 2026, proceeds: "324000", realized: "324000" },
        { year: 2025, proceeds: "1940000", realized: "1940000" },
      ],
    });

    expect(result.byYear).toEqual([
      // 324 sales + 30,000 bond (10%).
      {
        year: 2026,
        realized: "324000.00",
        income: "300000.00",
        foreignIncome: "0.00",
        tax: "30324.00",
      },
      // 1,940 sales + 100,000 deposit (20%); foreign income not taxed here.
      {
        year: 2025,
        realized: "1940000.00",
        income: "500000.00",
        foreignIncome: "700000.00",
        tax: "101940.00",
      },
      // 760 sales + 100,000 dividend (10%).
      {
        year: 2024,
        realized: "760000.00",
        income: "1000000.00",
        foreignIncome: "0.00",
        tax: "100760.00",
      },
    ]);
    // The detail only carries the selected year.
    expect(result.income.map((r) => r.symbol)).toEqual(["ORI"]);
    expect(result.estimatedTax).toBe("30000.00");
  });

  it("adds a by-year row for a year that has income but no trades", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [row({ symbol: "interest", category: "deposit_interest", gross: "100", year: 2023 })],
    });
    expect(result.byYear).toEqual([
      { year: 2023, realized: "0.00", income: "100.00", foreignIncome: "0.00", tax: "20.00" },
    ]);
  });

  it("passes instrumentId through to disposal rows (for client-side row-key disambiguation)", () => {
    // indonesianFinalTax constructs IdDisposalTax by spreading the input row
    // (`{ ...r, tax }`), so instrumentId — used by the web tier to key rows that
    // share a displayed symbol (dual listings, the `instrumentId.slice(0, 8)`
    // fallback for unnamed instruments) — must survive. If a future refactor
    // replaces the spread with an explicit field list, this test catches the
    // silent break before it reaches production.
    const result = indonesianFinalTax({
      ...empty,
      disposals: [
        { instrumentId: "inst-A", symbol: "DUP", when: "2026-05-15", proceeds: "100" },
        { instrumentId: "inst-B", symbol: "DUP", when: "2026-05-15", proceeds: "200" },
      ],
    });
    expect(result.disposals[0]?.instrumentId).toBe("inst-A");
    expect(result.disposals[1]?.instrumentId).toBe("inst-B");
    expect(result.disposals[0]?.tax).toBe("0.10");
    expect(result.disposals[1]?.tax).toBe("0.20");
  });
});

describe("mergeIndonesianFinalTax", () => {
  it("concatenates rows and re-derives every total and by-year row", () => {
    const a = indonesianFinalTax({
      year: 2026,
      disposals: [{ symbol: "BBNI", when: "2026-05-18", proceeds: "1000000" }],
      income: [
        row({ symbol: "BBCA", category: "domestic_dividend", gross: "500000" }),
        row({ symbol: "AAPL", category: "foreign", gross: "160000", recordedTax: "24000" }),
      ],
      byYear: [{ year: 2026, proceeds: "1000000", realized: "100000" }],
    });
    const b = indonesianFinalTax({
      year: 2026,
      disposals: [],
      income: [
        row({ symbol: "interest", category: "deposit_interest", gross: "100000" }),
        row({ symbol: "ORI", category: "bond_interest", gross: "50000", year: 2025 }),
      ],
      byYear: [],
    });
    const m = mergeIndonesianFinalTax([a, b]);
    expect(m.disposals).toHaveLength(1);
    expect(m.income.map((r) => r.symbol)).toEqual(["BBCA", "AAPL", "interest"]);
    expect(m.totalProceeds).toBe("1000000.00");
    expect(m.totalSalesTax).toBe("1000.00");
    expect(m.totalIncomeGross).toBe("600000.00");
    expect(m.totalIncomeTax).toBe("70000.00");
    expect(m.foreignIncomeGross).toBe("160000.00");
    expect(m.foreignTaxWithheld).toBe("24000.00");
    expect(m.estimatedTax).toBe("71000.00");
    expect(m.taxWithheldAtSource).toBe("21000.00");
    expect(m.taxToSelfPay).toBe("50000.00");
    expect(m.incomeByCategory.map((c) => [c.category, c.tax])).toEqual([
      ["domestic_dividend", "50000.00"],
      ["deposit_interest", "20000.00"],
      ["foreign", null],
    ]);
    expect(m.byYear).toEqual([
      {
        year: 2026,
        realized: "100000.00",
        income: "600000.00",
        foreignIncome: "160000.00",
        tax: "71000.00",
      },
      { year: 2025, realized: "0.00", income: "50000.00", foreignIncome: "0.00", tax: "5000.00" },
    ]);
  });

  it("an empty list merges to zeros", () => {
    const m = mergeIndonesianFinalTax([]);
    expect(m.estimatedTax).toBe("0.00");
    expect(m.income).toEqual([]);
    expect(m.byYear).toEqual([]);
  });
});

describe("the Rp7.5M small-balance exemption for bank interest", () => {
  /** A cash row of a portfolio: `price` carries the amount for deposits and interest. */
  const tx = (
    type: CoreTransaction["type"],
    price: string,
    currency: string,
    date: string,
  ): CoreTransaction => ({
    instrumentId: null,
    type,
    quantity: "0",
    price,
    fees: "0",
    currency,
    executedAt: new Date(`${date}T00:00:00.000Z`),
  });
  /** USD → IDR at 16,000, nothing else. */
  const fx: FxRateFn = (from, to) =>
    from === to ? "1" : from === "USD" && to === "IDR" ? "16000" : null;
  const interest = (o: Partial<IdIncomeInput>) =>
    row({ symbol: "Cash interest · IDR", category: "deposit_interest", gross: "10000", ...o });

  it("exempts a balance of exactly Rp7,500,000 and taxes Rp7,500,001", () => {
    expect(idDepositInterestExempt("7500000")).toBe(true);
    expect(idDepositInterestExempt("7500000.00")).toBe(true);
    expect(idDepositInterestExempt("7500001")).toBe(false);
    expect(idDepositInterestExempt("7500000.01")).toBe(false);
    expect(idDepositInterestExempt("0")).toBe(true);
  });

  it("taxes interest whose balance is unknown or negative (a data gap, not a small balance)", () => {
    expect(idDepositInterestExempt(null)).toBe(false);
    expect(idDepositInterestExempt(undefined)).toBe(false);
    expect(idDepositInterestExempt("-1")).toBe(false);
  });

  it("applies 0 tax to exempt interest, keeps it in the gross, and labels the row", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [
        interest({ gross: "10000", depositBalanceIdr: "7500000" }),
        interest({ gross: "40000", depositBalanceIdr: "7500001" }),
      ],
    });
    expect(result.income).toEqual([
      expect.objectContaining({
        category: "deposit_interest",
        exemption: "small_balance",
        rate: "0",
        gross: "10000.00",
        tax: "0.00",
        net: "10000.00",
        taxBasis: null,
      }),
      expect.objectContaining({
        category: "deposit_interest",
        exemption: null,
        rate: "0.20",
        gross: "40000.00",
        tax: "8000.00",
        taxBasis: "estimated",
      }),
    ]);
    expect(result.totalIncomeGross).toBe("50000.00");
    expect(result.totalIncomeTax).toBe("8000.00");
    expect(result.estimatedTax).toBe("8000.00");
    expect(result.incomeByCategory).toEqual([
      {
        category: "deposit_interest",
        rate: "0.20",
        gross: "50000.00",
        exemptGross: "10000.00",
        tax: "8000.00",
        withheldAtSource: true,
      },
    ]);
    expect(result.byYear).toEqual([
      { year: 2026, realized: "0.00", income: "50000.00", foreignIncome: "0.00", tax: "8000.00" },
    ]);
  });

  it("uses a withholding the bank recorded even when the balance looks small", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [interest({ gross: "10000", recordedTax: "2000", depositBalanceIdr: "100" })],
    });
    expect(result.income[0]).toMatchObject({ exemption: null, tax: "2000.00" });
  });

  it("never exempts securities income, whatever the balance", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [
        row({
          symbol: "BBCA",
          category: "domestic_dividend",
          gross: "100000",
          depositBalanceIdr: "0",
        }),
        row({
          symbol: "ORI023",
          category: "bond_interest",
          gross: "100000",
          depositBalanceIdr: "0",
        }),
        row({
          symbol: "RDPU",
          category: "fund_distribution",
          gross: "100000",
          depositBalanceIdr: "0",
        }),
      ],
    });
    expect(result.income.map((r) => [r.symbol, r.exemption, r.tax])).toEqual([
      ["BBCA", null, "10000.00"],
      ["ORI023", null, "10000.00"],
      ["RDPU", null, "0.00"],
    ]);
    expect(result.incomeByCategory.every((c) => c.exemptGross === "0.00")).toBe(true);
  });

  describe("the balance before a payment", () => {
    it("is the cash of every earlier row, the payment itself and later rows left out", () => {
      const txns = [
        tx("deposit", "5000000", "IDR", "2026-01-02"),
        tx("interest", "1000", "IDR", "2026-01-31"),
        tx("deposit", "9000000", "IDR", "2026-02-15"),
        tx("interest", "2000", "IDR", "2026-02-28"),
      ];
      expect(idCashBalancesBefore(txns, txns[1]!)).toEqual({ IDR: "5000000" });
      expect(idCashBalancesBefore(txns, txns[3]!)).toEqual({ IDR: "14001000" });
    });

    it("includes other rows at the payment's own instant, but not the payment", () => {
      // Date-only imports book a same-day deposit at the same midnight as the interest.
      const txns = [
        tx("deposit", "7000000", "IDR", "2026-01-02"),
        tx("deposit", "600000", "IDR", "2026-01-31"),
        tx("interest", "1000", "IDR", "2026-01-31"),
      ];
      const balances = idCashBalancesBefore(txns, txns[2]!);
      expect(balances).toEqual({ IDR: "7600000" });
      expect(idDepositInterestExempt(idDepositBalanceIdr(balances, fx))).toBe(false);
    });

    it("is unknown before the first explicit cash movement (imported trades only)", () => {
      const txns = [
        tx("interest", "1000", "IDR", "2026-01-31"),
        tx("interest", "1000", "IDR", "2026-02-28"),
      ];
      expect(idCashBalancesBefore(txns, txns[1]!)).toBeNull();
      expect(idDepositBalanceIdr(null, fx)).toBeNull();
    });

    it("counts IDR cash with no portfolio country the same way", () => {
      // classifyIdIncome treats IDR cash interest without a country as Indonesian bank
      // interest; the balance then decides the exemption like for an ID portfolio.
      expect(classifyIdIncome({ type: "interest", currency: "IDR", portfolioCountry: null })).toBe(
        "deposit_interest",
      );
      const txns = [
        tx("deposit", "2000000", "IDR", "2026-01-02"),
        tx("interest", "800", "IDR", "2026-01-31"),
      ];
      const balance = idDepositBalanceIdr(idCashBalancesBefore(txns, txns[1]!), fx);
      expect(balance).toBe("2000000");
      expect(idDepositInterestExempt(balance)).toBe(true);
    });

    it("converts a foreign-currency balance to IDR, which can cross the threshold", () => {
      // Rp7,000,000 on its own is exempt; USD 50 (Rp800,000) at the same bank takes the
      // total to Rp7,800,000.
      const txns = [
        tx("deposit", "7000000", "IDR", "2026-01-02"),
        tx("deposit", "50", "USD", "2026-01-03"),
        tx("interest", "1000", "IDR", "2026-01-31"),
      ];
      const balances = idCashBalancesBefore(txns, txns[2]!);
      expect(balances).toEqual({ IDR: "7000000", USD: "50" });
      const idr = idDepositBalanceIdr(balances, fx);
      expect(idr).toBe("7800000");
      expect(idDepositInterestExempt(idr)).toBe(false);
      expect(idDepositInterestExempt(idDepositBalanceIdr({ IDR: "7000000" }, fx))).toBe(true);
    });

    it("gives every payment the same balance in one walk as one by one", () => {
      const txns = [
        tx("interest", "50", "IDR", "2025-12-31"), // before any cash movement: unknown
        tx("deposit", "7000000", "IDR", "2026-01-02"),
        tx("deposit", "50", "USD", "2026-01-31"),
        tx("interest", "1000", "IDR", "2026-01-31"),
        tx("interest", "2", "USD", "2026-01-31"),
        tx("withdrawal", "300000", "IDR", "2026-02-10"),
        tx("interest", "900", "IDR", "2026-02-28"),
      ].reverse(); // unsorted input
      const payments = txns.filter((t) => t.type === "interest");
      const walked = idCashBalancesAtPayments(txns, payments);
      expect(walked.size).toBe(payments.length);
      for (const p of payments) {
        // Record for record, every currency (not just the IDR total).
        expect(walked.get(p)).toEqual(idCashBalancesBefore(txns, p));
      }
      expect(walked.get(txns.find((t) => t.price === "50" && t.type === "interest")!)).toBeNull();
      // A payment only in its own currency (EUR here) adds no "0" entry; one outside the
      // list has none at all.
      const eur = tx("interest", "3", "EUR", "2026-03-31");
      const withEur = [...txns, eur];
      expect(idCashBalancesAtPayments(withEur, [eur]).get(eur)).toEqual(
        idCashBalancesBefore(withEur, eur),
      );
      expect(idCashBalancesBefore(withEur, eur)).not.toHaveProperty("EUR");
      expect(idCashBalancesAtPayments(txns, [eur]).has(eur)).toBe(false);
    });

    it("is unknown when a currency has no rate into IDR, unless its balance is zero", () => {
      expect(idDepositBalanceIdr({ IDR: "100", EUR: "5" }, fx)).toBeNull();
      expect(idDepositBalanceIdr({ IDR: "100", EUR: "0" }, fx)).toBe("100");
    });
  });
});

describe("bond and sukuk discount", () => {
  const discount = (on: string, gross: string, extra: Partial<IdIncomeInput> = {}) =>
    row({ symbol: "ORI020", category: "bond_discount", gross, on, ...extra });

  it("taxes a sale before 30 Aug 2021 at 15% and one on that date at 10%", () => {
    const early = indonesianFinalTax({
      year: 2021,
      disposals: [],
      income: [discount("2021-08-01", "10000", { year: 2021 })],
      byYear: [{ year: 2021, proceeds: "0", realized: "0", salesTax: "0" }],
    });
    expect(early.income[0]).toMatchObject({
      category: "bond_discount",
      rate: "0.15",
      tax: "1500.00",
      withheldAtSource: true,
      taxBasis: "estimated",
      exemption: null,
    });
    expect(early.byYear[0]!.tax).toBe("1500.00");
    expect(early.estimatedTax).toBe("1500.00");
    expect(early.taxWithheldAtSource).toBe("1500.00");
    expect(early.taxToSelfPay).toBe("0.00");

    const cutover = indonesianFinalTax({
      ...empty,
      income: [discount("2021-08-30", "10000")],
    });
    expect(cutover.income[0]).toMatchObject({ rate: "0.10", tax: "1000.00" });
  });

  it("does not tax a discount below cost and does not reduce an earlier coupon", () => {
    const result = indonesianFinalTax({
      ...empty,
      income: [
        row({ symbol: "ORI020", category: "bond_interest", gross: "100000" }),
        discount("2026-06-01", "-10000"),
      ],
    });
    expect(result.income.find((r) => r.category === "bond_interest")).toMatchObject({
      tax: "10000.00",
    });
    expect(result.income.find((r) => r.category === "bond_discount")).toMatchObject({
      tax: "0.00",
      rate: "0",
      exemption: "negative_discount",
      gross: "-10000.00",
      withheldAtSource: true,
    });
    expect(result.estimatedTax).toBe("10000.00");
    expect(result.taxWithheldAtSource).toBe("10000.00");
  });

  it("lets a recorded withholding win, including when the discount is negative", () => {
    const recorded = indonesianFinalTax({
      ...empty,
      income: [discount("2026-06-01", "10000", { recordedTax: "2500" })],
    });
    expect(recorded.income[0]).toMatchObject({
      tax: "2500.00",
      taxBasis: "recorded",
      exemption: null,
      rate: "0.10",
    });
    const loss = indonesianFinalTax({
      ...empty,
      income: [discount("2026-06-01", "-10000", { recordedTax: "400" })],
    });
    expect(loss.income[0]).toMatchObject({
      tax: "400.00",
      exemption: null,
      taxBasis: "recorded",
    });
  });

  it("keeps a 15% discount and a 10% discount in the same year as two rows", () => {
    const result = indonesianFinalTax({
      year: 2021,
      disposals: [],
      income: [
        discount("2021-08-01", "10000", { year: 2021 }),
        discount("2021-09-01", "10000", { year: 2021 }),
      ],
      byYear: [],
    });
    expect(result.income).toHaveLength(2);
    expect(result.income.map((r) => r.rate).sort()).toEqual(["0.10", "0.15"]);
    expect(result.estimatedTax).toBe("2500.00");
    expect(result.incomeByCategory).toEqual([
      expect.objectContaining({
        category: "bond_discount",
        gross: "20000.00",
        tax: "2500.00",
        withheldAtSource: true,
      }),
    ]);
  });
});
