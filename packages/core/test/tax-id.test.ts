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
  type IdIncomeInput,
} from "../src/tax-id.js";

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
    expect(idIncomeTaxRate("deposit_interest")).toBe("0.20");
    expect(idIncomeTaxRate("fund_distribution")).toBe("0");
    expect(idIncomeTaxRate("foreign")).toBeNull();
  });

  it("marks only bond and deposit interest as withheld at source", () => {
    expect(idIncomeWithheldAtSource("bond_interest")).toBe(true);
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
        tax: "100000.00",
        withheldAtSource: false,
      },
      { category: "foreign", rate: null, gross: "2010000.00", tax: null, withheldAtSource: false },
    ]);
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
