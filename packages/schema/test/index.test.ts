import { describe, it, expect } from "vitest";
import {
  decimalString,
  currencyCode,
  countryCode,
  COUNTRY_CODES,
  portfolioPatchSchema,
  transactionInputSchema,
  parsedTransactionSchema,
  portfolioInputSchema,
  accountHolderInputSchema,
  searchQuerySchema,
} from "../src/index.js";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("decimalString", () => {
  it("accepts decimal strings", () => {
    for (const v of ["100", "9500.50", "-5", "0"]) {
      expect(decimalString.parse(v)).toBe(v);
    }
  });
  it("rejects non-decimals", () => {
    for (const v of ["abc", "1,000", "", "1.2.3"]) {
      expect(() => decimalString.parse(v)).toThrow();
    }
  });
});

describe("currencyCode", () => {
  it("normalises to upper case", () => {
    expect(currencyCode.parse("idr")).toBe("IDR");
    expect(currencyCode.parse(" eur ")).toBe("EUR");
  });
  it("requires exactly 3 letters", () => {
    expect(() => currencyCode.parse("RUPIAH")).toThrow();
  });
});

describe("countryCode", () => {
  it("normalises an ISO 3166-1 alpha-2 code to upper case", () => {
    expect(countryCode.parse("id")).toBe("ID");
    expect(countryCode.parse(" de ")).toBe("DE");
  });
  it("rejects anything that isn't an assigned alpha-2 code", () => {
    for (const v of ["IDN", "I", "", "XX", "EU", "1D"]) {
      expect(() => countryCode.parse(v)).toThrow();
    }
  });
  it("lists every assigned code once", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
  });
});

describe("portfolioInputSchema", () => {
  it("defaults the currency to IDR and leaves the holder unset", () => {
    const parsed = portfolioInputSchema.parse({ name: "Main" });
    expect(parsed.baseCurrency).toBe("IDR");
    expect(parsed.accountHolderId).toBeUndefined();
  });
  it("accepts an account holder id and allows clearing it with null", () => {
    expect(portfolioInputSchema.parse({ name: "Kid", accountHolderId: UUID }).accountHolderId).toBe(
      UUID,
    );
    expect(portfolioInputSchema.parse({ name: "Kid", accountHolderId: null }).accountHolderId).toBe(
      null,
    );
  });
  it("rejects a non-uuid account holder id", () => {
    expect(() =>
      portfolioInputSchema.parse({ name: "X", accountHolderId: "not-a-uuid" }),
    ).toThrow();
  });
  it("trims an optional brokerage and leaves it undefined when omitted", () => {
    expect(portfolioInputSchema.parse({ name: "X" }).brokerage).toBeUndefined();
    expect(
      portfolioInputSchema.parse({ name: "X", brokerage: "  Trade Republic  " }).brokerage,
    ).toBe("Trade Republic");
  });
  it("takes an optional country, upper-cased, and allows clearing it with null", () => {
    expect(portfolioInputSchema.parse({ name: "X" }).country).toBeUndefined();
    expect(portfolioInputSchema.parse({ name: "X", country: "id" }).country).toBe("ID");
    expect(portfolioPatchSchema.parse({ country: null }).country).toBeNull();
    expect(() => portfolioPatchSchema.parse({ country: "IDN" })).toThrow();
  });
  it("takes a crypto venue of domestic or foreign, and allows clearing it", () => {
    expect(portfolioInputSchema.parse({ name: "X" }).cryptoTaxVenue).toBeUndefined();
    expect(
      portfolioInputSchema.parse({ name: "X", cryptoTaxVenue: "domestic" }).cryptoTaxVenue,
    ).toBe("domestic");
    expect(portfolioPatchSchema.parse({ cryptoTaxVenue: null }).cryptoTaxVenue).toBeNull();
    expect(() => portfolioPatchSchema.parse({ cryptoTaxVenue: "binance" })).toThrow();
  });
});

describe("accountHolderInputSchema", () => {
  it("defaults the type to 'other' and trims the name", () => {
    const parsed = accountHolderInputSchema.parse({ name: "  Emma  " });
    expect(parsed.name).toBe("Emma");
    expect(parsed.type).toBe("other");
    expect(parsed.birthYear).toBeUndefined();
  });
  it("accepts a child holder with a birth year", () => {
    const parsed = accountHolderInputSchema.parse({ name: "Kid", type: "child", birthYear: 2017 });
    expect(parsed).toMatchObject({ name: "Kid", type: "child", birthYear: 2017 });
  });
  it("rejects an empty name and an unknown type", () => {
    expect(() => accountHolderInputSchema.parse({ name: "" })).toThrow();
    expect(() => accountHolderInputSchema.parse({ name: "X", type: "pet" })).toThrow();
  });
});

describe("transactionInputSchema", () => {
  it("applies defaults and uppercases the currency", () => {
    const tx = transactionInputSchema.parse({
      portfolioId: UUID,
      type: "buy",
      price: "9500",
      quantity: "100",
      currency: "idr",
      executedAt: "2026-01-15T03:00:00.000Z",
    });
    expect(tx.fees).toBe("0");
    expect(tx.source).toBe("manual");
    expect(tx.currency).toBe("IDR");
    expect(tx.executedAt).toBeInstanceOf(Date);
  });

  it("only allows a loan link on a loan_repayment, and an installment only with a loan", () => {
    const base = {
      portfolioId: UUID,
      price: "1000",
      currency: "IDR",
      executedAt: "2026-02-10T00:00:00.000Z",
    };
    const ok = transactionInputSchema.parse({
      ...base,
      type: "loan_repayment",
      loanId: UUID,
      installmentN: 2,
    });
    expect(ok).toMatchObject({ loanId: UUID, installmentN: 2 });
    // null unlinks; omitted stays undefined (PATCH leaves a stored link alone).
    expect(
      transactionInputSchema.parse({ ...base, type: "loan_repayment", loanId: null }).loanId,
    ).toBeNull();
    expect(
      transactionInputSchema.parse({ ...base, type: "loan_repayment" }).loanId,
    ).toBeUndefined();
    expect(() =>
      transactionInputSchema.parse({ ...base, type: "deposit", loanId: UUID }),
    ).toThrow();
    expect(() =>
      transactionInputSchema.parse({ ...base, type: "loan_repayment", installmentN: 2 }),
    ).toThrow();
    expect(() =>
      transactionInputSchema.parse({
        ...base,
        type: "loan_repayment",
        loanId: UUID,
        installmentN: 0,
      }),
    ).toThrow();
  });

  it("accepts kind and passes it through; omitting it leaves it undefined", () => {
    const withKind = transactionInputSchema.parse({
      portfolioId: UUID,
      type: "savings_plan",
      price: "200",
      quantity: "1.5",
      currency: "EUR",
      executedAt: "2026-03-01T00:00:00.000Z",
      kind: "saveback",
    });
    expect(withKind.kind).toBe("saveback");

    const withoutKind = transactionInputSchema.parse({
      portfolioId: UUID,
      type: "buy",
      price: "100",
      quantity: "10",
      currency: "IDR",
      executedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(withoutKind.kind).toBeUndefined();
  });

  it("accepts an attested reinvestment flag and leaves it unset when omitted", () => {
    const flagged = transactionInputSchema.parse({
      portfolioId: UUID,
      type: "dividend",
      price: "1000",
      currency: "IDR",
      executedAt: "2026-04-01T00:00:00.000Z",
      idReinvested: true,
    });
    expect(flagged.idReinvested).toBe(true);
    const omitted = transactionInputSchema.parse({
      portfolioId: UUID,
      type: "buy",
      price: "1",
      quantity: "1",
      currency: "IDR",
      executedAt: "2026-04-01T00:00:00.000Z",
    });
    expect(omitted.idReinvested).toBeUndefined();
  });

  it("accepts kind: null", () => {
    const tx = transactionInputSchema.parse({
      portfolioId: UUID,
      type: "buy",
      price: "100",
      quantity: "10",
      currency: "IDR",
      executedAt: "2026-03-01T00:00:00.000Z",
      kind: null,
    });
    expect(tx.kind).toBeNull();
  });

  it("rejects an invalid portfolio id and bad decimals", () => {
    expect(() =>
      transactionInputSchema.parse({
        portfolioId: "not-a-uuid",
        type: "buy",
        currency: "IDR",
        executedAt: new Date(),
      }),
    ).toThrow();

    expect(() =>
      transactionInputSchema.parse({
        portfolioId: UUID,
        type: "buy",
        price: "nine thousand",
        currency: "IDR",
        executedAt: new Date(),
      }),
    ).toThrow();
  });
});

describe("parsedTransactionSchema", () => {
  it("parses a gold-per-gram draft and coerces the date", () => {
    const parsed = parsedTransactionSchema.parse({
      assetClass: "gold",
      action: "buy",
      name: "Tabungan Emas",
      quantity: "5.25",
      unit: "grams",
      price: "1100000",
      currency: "IDR",
      executedAt: "2026-02-01",
      confidence: 0.94,
    });
    expect(parsed.unit).toBe("grams");
    expect(parsed.fees).toBe("0");
    expect(parsed.executedAt).toBeInstanceOf(Date);
  });

  it("rejects confidence outside [0,1]", () => {
    expect(() =>
      parsedTransactionSchema.parse({
        assetClass: "equity",
        action: "buy",
        quantity: "1",
        unit: "shares",
        price: "100",
        currency: "USD",
        executedAt: "2026-02-01",
        confidence: 1.5,
      }),
    ).toThrow();
  });
});

describe("searchQuerySchema", () => {
  it("requires q and defaults limit to 20", () => {
    const parsed = searchQuerySchema.parse({ q: "apple" });
    expect(parsed.q).toBe("apple");
    expect(parsed.limit).toBe(20);
    expect(parsed.types).toBeUndefined();
    expect(parsed.holderId).toBeUndefined();
  });

  it("trims whitespace from q", () => {
    const parsed = searchQuerySchema.parse({ q: "  bbca  " });
    expect(parsed.q).toBe("bbca");
  });

  it("rejects an empty q after trimming", () => {
    expect(() => searchQuerySchema.parse({ q: "   " })).toThrow();
  });

  it("coerces limit from string and clamps to [1,50]", () => {
    expect(searchQuerySchema.parse({ q: "x", limit: "5" }).limit).toBe(5);
    expect(() => searchQuerySchema.parse({ q: "x", limit: "0" })).toThrow();
    expect(() => searchQuerySchema.parse({ q: "x", limit: "51" })).toThrow();
  });

  it("accepts a valid holderId", () => {
    // z.guid() accepts any UUID-shaped string (less strict than RFC-4122 variant bits).
    const id = "11111111-1111-1111-1111-111111111111";
    expect(searchQuerySchema.parse({ q: "x", holderId: id }).holderId).toBe(id);
  });

  it("rejects an invalid holderId", () => {
    expect(() => searchQuerySchema.parse({ q: "x", holderId: "not-a-uuid" })).toThrow();
  });

  it("accepts types as a single value (string → array)", () => {
    const parsed = searchQuerySchema.parse({ q: "x", types: "buy" });
    expect(parsed.types).toEqual(["buy"]);
  });

  it("accepts types as an array", () => {
    const parsed = searchQuerySchema.parse({ q: "x", types: ["buy", "sell"] });
    expect(parsed.types).toEqual(["buy", "sell"]);
  });

  it("rejects unknown transaction types in the types array", () => {
    expect(() => searchQuerySchema.parse({ q: "x", types: ["unknown_type"] })).toThrow();
  });
});
