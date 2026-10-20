import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { fxRates, instruments } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function setTaxRegime(t: string, regime: "DE" | "ID") {
  const res = await app.inject({
    method: "PUT",
    url: "/me/preferences",
    headers: auth(t),
    payload: { taxRegime: regime },
  });
  expect(res.statusCode).toBe(200);
}

async function seedTransaction(
  app: App,
  portfolioId: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
) {
  const res = await app.inject({
    method: "POST",
    url: `/portfolios/${portfolioId}/transactions`,
    headers,
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`seed tx failed: ${res.body}`);
  return res.json();
}

async function createHolder(t: string, opts: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/account-holders",
    headers: auth(t),
    payload: { name: "ID Holder", type: "self", ...opts },
  });
  return res.json().id as string;
}

async function createPortfolio(t: string, opts: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name: "ID Portfolio", baseCurrency: "EUR", ...opts },
  });
  return res.json().id as string;
}

describe("GET /portfolios/:id/tax — Indonesian taxRegime", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it("returns indonesianFinalTax fields when taxRegime='ID' (no FSA required on holder)", async () => {
    const t = await token("tax-id-1");
    // ID users typically have NO FSA allocation; the DE 422 must NOT fire under ID.
    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR" });
    await setTaxRegime(t, "ID");

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.year).toBe(2025);
    expect(body.regime).toBe("ID");
    // German allowanceUsage must NOT be returned for ID users.
    expect(body.allowanceUsage).toBeUndefined();
    // Indonesian final-tax payload must be present with the expected shape.
    expect(body.indonesianFinalTax).toBeDefined();
    expect(body.indonesianFinalTax.totalProceeds).toBe("0.00");
    expect(body.indonesianFinalTax.totalSalesTax).toBe("0.00");
    expect(body.indonesianFinalTax.totalIncomeGross).toBe("0.00");
    expect(body.indonesianFinalTax.totalIncomeTax).toBe("0.00");
    expect(body.indonesianFinalTax.totalIncomeNet).toBe("0.00");
    expect(body.indonesianFinalTax.income).toEqual([]);
    expect(body.indonesianFinalTax.incomeByCategory).toEqual([]);
    expect(body.indonesianFinalTax.estimatedTax).toBe("0.00");
    expect(body.indonesianFinalTax.byYear).toEqual([]);
    expect(body.harvestSuggestions).toEqual([]);
  });

  it("computes the ID 0.1% sales tax + 10% dividend tax from a held position's buy/sell + dividend", async () => {
    const t = await token("tax-id-2");
    // Seed an instrument under this user's instrument table (unique symbol so test is hermetic).
    const [equity] = await app.db
      .insert(instruments)
      .values({
        symbol: "IDX-AUDIT",
        market: "IDX",
        assetClass: "equity",
        currency: "EUR",
        name: "IDX Audit Co",
      })
      .returning();

    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR" });
    await setTaxRegime(t, "ID");

    await seedTransaction(app, portfolioId, auth(t), {
      type: "buy",
      instrumentId: equity.id,
      quantity: "10",
      price: "100",
      currency: "EUR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, auth(t), {
      type: "sell",
      instrumentId: equity.id,
      quantity: "10",
      price: "150",
      currency: "EUR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, auth(t), {
      type: "dividend",
      instrumentId: equity.id,
      quantity: "0",
      price: "200",
      currency: "EUR",
      executedAt: "2025-05-01T00:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.regime).toBe("ID");
    const id = body.indonesianFinalTax;
    expect(id).toBeDefined();
    // Proceeds = 10 × 150 = 1500; 0.1% sales tax = 1.50
    expect(id.totalProceeds).toBe("1500.00");
    expect(id.totalSalesTax).toBe("1.50");
    // Dividend recorded as a lump-sum (qty=0): price=200 is the gross dividend of an IDX
    // stock — a domestic dividend, 10% of gross, paid by the investor (not withheld).
    expect(id.totalIncomeGross).toBe("200.00");
    expect(id.totalIncomeTax).toBe("20.00");
    expect(id.totalIncomeNet).toBe("180.00");
    expect(id.income).toEqual([
      expect.objectContaining({
        symbol: "IDX-AUDIT",
        category: "domestic_dividend",
        rate: "0.10",
        tax: "20.00",
        withheldAtSource: false,
      }),
    ]);
    expect(id.taxToSelfPay).toBe("20.00");
    expect(id.taxWithheldAtSource).toBe("1.50");
    // Estimated = salesTax + dividendTax = 1.50 + 20.00 = 21.50
    expect(id.estimatedTax).toBe("21.50");
    // At least one byYear row for the 2025 tax year.
    expect(Array.isArray(id.byYear)).toBe(true);
    const yearRow = id.byYear.find((r: { year: number }) => r.year === 2025);
    expect(yearRow).toBeDefined();
    expect(yearRow.tax).toBe("21.50");
  });

  it("levies the 0.1% on quantity × price, and a recorded sell tax wins", async () => {
    const t = await token("tax-id-gross");
    const [equity] = await app.db
      .insert(instruments)
      .values({
        symbol: "IDX-GROSS",
        market: "IDX",
        assetClass: "equity",
        currency: "EUR",
        name: "IDX Gross Co",
      })
      .returning();
    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR" });
    await setTaxRegime(t, "ID");

    await seedTransaction(app, portfolioId, auth(t), {
      type: "buy",
      instrumentId: equity.id,
      quantity: "10",
      price: "100",
      currency: "EUR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    // Fees must not shrink the base: 10 × 150 = 1500, not 1485. No recorded tax.
    await seedTransaction(app, portfolioId, auth(t), {
      type: "sell",
      instrumentId: equity.id,
      quantity: "4",
      price: "150",
      fees: "15",
      currency: "EUR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });
    // Same day, so the two sells are one row. This one carries the withholding.
    await seedTransaction(app, portfolioId, auth(t), {
      type: "sell",
      instrumentId: equity.id,
      quantity: "6",
      price: "150",
      tax: "9",
      currency: "EUR",
      executedAt: "2025-06-15T12:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().indonesianFinalTax;
    // 4 × 150 = 600 estimated at 0.1% → 0.60; 6 × 150 = 900 recorded as 9.
    expect(id.disposals).toEqual([
      expect.objectContaining({
        symbol: "IDX-GROSS",
        proceeds: "1500.00",
        tax: "9.60",
        taxBasis: "mixed",
      }),
    ]);
    expect(id.totalProceeds).toBe("1500.00");
    expect(id.totalSalesTax).toBe("9.60");
    expect(id.taxWithheldAtSource).toBe("9.60");
    const yearRow = id.byYear.find((r: { year: number }) => r.year === 2025);
    expect(yearRow.tax).toBe("9.60");
  });

  it("estimates 0.1% of the gross when the sell's recorded tax is zero", async () => {
    const t = await token("tax-id-zero-tax");
    const [equity] = await app.db
      .insert(instruments)
      .values({
        symbol: "IDX-ZERO",
        market: "IDX",
        assetClass: "equity",
        currency: "EUR",
        name: "IDX Zero Tax Co",
      })
      .returning();
    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR" });
    await setTaxRegime(t, "ID");
    await seedTransaction(app, portfolioId, auth(t), {
      type: "buy",
      instrumentId: equity.id,
      quantity: "10",
      price: "100",
      currency: "EUR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    // tax "0" is not an exemption. A blank tax is rejected by the input schema,
    // so the blank case is covered on the trade log instead.
    await seedTransaction(app, portfolioId, auth(t), {
      type: "sell",
      instrumentId: equity.id,
      quantity: "10",
      price: "200",
      fees: "20",
      tax: "0",
      currency: "EUR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().indonesianFinalTax;
    // 10 × 200 = 2000, not 1980. 0.1% of the gross is 2.00, and the basis is estimated.
    expect(id.disposals).toEqual([
      expect.objectContaining({
        symbol: "IDX-ZERO",
        proceeds: "2000.00",
        tax: "2.00",
        taxBasis: "estimated",
      }),
    ]);
    expect(id.totalSalesTax).toBe("2.00");
  });

  it("keeps the DE branch returning allowanceUsage when taxRegime='DE' (no behavior change)", async () => {
    const t = await token("tax-id-3");
    const holderId = await createHolder(t, {
      name: "DE Holder",
      taxAllowanceAnnual: "1000",
      capitalGainsTaxRate: "0.25",
      taxResidence: "DE",
    });
    const portfolioId = await createPortfolio(t, {
      accountHolderId: holderId,
      taxAllowanceAnnual: "1000",
    });
    // taxRegime defaults to "DE" — no PUT needed.
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.regime).toBe("DE");
    expect(body.allowanceUsage).toBeDefined();
    expect(body.allowanceUsage.allowanceAnnual).toBe("1000.00");
    expect(body.indonesianFinalTax).toBeUndefined();
  });
});

describe("GET /networth/tax — Indonesian taxRegime (W2: surfaces ID payload regardless of selection)", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it("returns indonesianFinalTax on the holder entry when taxRegime='ID' (no FSA allocation required)", async () => {
    const t = await token("tax-id-nw-1");
    await setTaxRegime(t, "ID");
    // Seed an instrument so the transactions resolve to a real instrumentId;
    // without this the trade-log entries have no legs to iterate.
    const [eq] = await app.db
      .insert(instruments)
      .values({
        symbol: "IDX-NW1",
        market: "IDX",
        assetClass: "equity",
        currency: "IDR",
        name: "IDX NW1",
      })
      .returning();
    // ID users typically have NO FSA allocation — holder has no taxAllowanceAnnual.
    const portfolioId = await createPortfolio(t, { baseCurrency: "IDR" });
    await seedTransaction(app, portfolioId, auth(t), {
      type: "buy",
      instrumentId: eq.id,
      quantity: "5",
      price: "100",
      currency: "IDR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, auth(t), {
      type: "sell",
      instrumentId: eq.id,
      quantity: "5",
      price: "150",
      currency: "IDR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      holder: { id: string; name: string };
      year: number;
      currency: string;
      allowanceUsage?: unknown;
      indonesianFinalTax?: {
        totalProceeds: string;
        totalSalesTax: string;
        totalIncomeGross: string;
        totalIncomeTax: string;
        estimatedTax: string;
      };
    }>;
    // /networth/tax used to return [] for ID users with no FSA. Now it returns the
    // holder's ID payload directly (the holder exists; taxAllowanceAnnual is just null).
    expect(body.length).toBeGreaterThanOrEqual(1);
    const [entry] = body;
    expect(entry.year).toBe(2025);
    // /networth/tax echoes the user's displayCurrency (IDR-denominated book here, so no
    // FX rate is needed — a missing rate is no longer silently 1:1, audit B2) — see /portfolios/:id/tax for per-portfolio FX.
    expect(entry.currency).toBe("IDR");
    expect(entry.indonesianFinalTax).toBeDefined();
    expect(entry.indonesianFinalTax!.totalProceeds).toBe("750.00");
    expect(entry.indonesianFinalTax!.totalSalesTax).toBe("0.75"); // 0.1% of 750
    // No German-shape fields leaked into the ID response.
    expect(entry.allowanceUsage).toBeUndefined();
  });

  it("rolls proceeds across multiple portfolios of the same holder into one ID payload", async () => {
    const t = await token("tax-id-nw-2");
    await setTaxRegime(t, "ID");
    await app.inject({
      method: "PATCH",
      url: "/me",
      headers: auth(t),
      payload: { displayCurrency: "EUR" },
    }); // EUR books shown in EUR: no FX rate needed (missing rates are no longer 1:1, audit B2)
    const [eq] = await app.db
      .insert(instruments)
      .values({
        symbol: "IDX-NW2",
        market: "IDX",
        assetClass: "equity",
        currency: "EUR",
        name: "IDX NW2",
      })
      .returning();
    const pf1 = await createPortfolio(t, { name: "NW-ID-1", baseCurrency: "EUR" });
    const pf2 = await createPortfolio(t, { name: "NW-ID-2", baseCurrency: "EUR" });
    await seedTransaction(app, pf1, auth(t), {
      type: "buy",
      instrumentId: eq.id,
      quantity: "2",
      price: "100",
      currency: "EUR",
      executedAt: "2025-02-01T00:00:00.000Z",
    });
    await seedTransaction(app, pf1, auth(t), {
      type: "sell",
      instrumentId: eq.id,
      quantity: "2",
      price: "200",
      currency: "EUR",
      executedAt: "2025-07-01T00:00:00.000Z",
    });
    await seedTransaction(app, pf2, auth(t), {
      type: "buy",
      instrumentId: eq.id,
      quantity: "1",
      price: "300",
      currency: "EUR",
      executedAt: "2025-03-01T00:00:00.000Z",
    });
    await seedTransaction(app, pf2, auth(t), {
      type: "sell",
      instrumentId: eq.id,
      quantity: "1",
      price: "500",
      currency: "EUR",
      executedAt: "2025-08-01T00:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      indonesianFinalTax?: { totalProceeds: string; totalSalesTax: string };
    }>;
    // 2*200 + 1*500 = 900; 0.1% sales tax = 0.90.
    const totalProceeds = body.reduce(
      (s, e) => s + Number(e.indonesianFinalTax?.totalProceeds ?? 0),
      0,
    );
    const totalSalesTax = body.reduce(
      (s, e) => s + Number(e.indonesianFinalTax?.totalSalesTax ?? 0),
      0,
    );
    expect(totalProceeds).toBe(900);
    expect(totalSalesTax).toBeCloseTo(0.9, 2);
  });
  it("applies no 0.1% sales tax to gold or EU-ETF disposals (IDX equity only)", async () => {
    const t = await token("tax-id-c4");
    const mk = async (symbol: string, market: string, assetClass: "gold" | "etf" | "equity") => {
      const [row] = await app.db
        .insert(instruments)
        .values({ symbol, market, assetClass, currency: "EUR", name: symbol })
        .returning();
      return row;
    };
    const gold = await mk("C4-GOLD", "XAU", "gold");
    const etf = await mk("C4-ETF", "XETRA", "etf");
    const idx = await mk("C4-IDX", "IDX", "equity");
    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR" });
    await setTaxRegime(t, "ID");
    for (const inst of [gold, etf, idx]) {
      await seedTransaction(app, portfolioId, auth(t), {
        type: "buy",
        instrumentId: inst.id,
        quantity: "10",
        price: "100",
        currency: "EUR",
        executedAt: "2025-01-15T00:00:00.000Z",
      });
      await seedTransaction(app, portfolioId, auth(t), {
        type: "sell",
        instrumentId: inst.id,
        quantity: "10",
        price: "200",
        currency: "EUR",
        executedAt: "2025-06-15T00:00:00.000Z",
      });
    }
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const id = res.json().indonesianFinalTax;
    // Only the IDX equity sale counts: 10 x 200 = 2000 proceeds, 0.1% = 2.00.
    expect(id.disposals).toHaveLength(1);
    expect(id.totalProceeds).toBe("2000.00");
    expect(id.totalSalesTax).toBe("2.00");
    const yearRow = id.byYear.find((r: { year: number }) => r.year === 2025);
    expect(yearRow.tax).toBe("2.00");
  });
});

describe("Indonesian income tax — a rate per income type, foreign income kept apart", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  type Category = {
    category: string;
    rate: string | null;
    gross: string;
    tax: string | null;
    withheldAtSource: boolean;
  };
  type IncomeRow = {
    symbol: string;
    category: string;
    rate: string | null;
    gross: string;
    tax: string | null;
    withheldAtSource: boolean;
    taxBasis: string | null;
    foreignTaxWithheld: string | null;
    cashSource?: { type: string; currency: string };
  };

  /** One IDR portfolio with a mixed 2025: an IDX dividend, two IDR bond coupons (one with
   *  a recorded withholding), IDR cash interest, an IDX reksa dana distribution, a US
   *  dividend (with US withholding) and EUR interest at a foreign bank. */
  async function seedMixedYear(sub: string) {
    const t = await token(sub);
    await setTaxRegime(t, "ID");
    const today = toDateKey(new Date());
    await app.db
      .insert(fxRates)
      .values([
        { base: "USD", quote: "IDR", rate: "16000", date: today },
        { base: "EUR", quote: "IDR", rate: "17000", date: today },
      ])
      .onConflictDoNothing();
    const mk = async (symbol: string, market: string, assetClass: string, currency: string) => {
      const [row] = await app.db
        .insert(instruments)
        .values({
          symbol,
          market,
          assetClass: assetClass as "equity",
          currency,
          name: symbol,
        })
        .returning();
      return row!;
    };
    const idxStock = await mk(`${sub}-BBCA`, "IDX", "equity", "IDR");
    const idrBond = await mk(`${sub}-ORI`, "IDX", "bond", "IDR");
    const reksaDana = await mk(`${sub}-RD`, "IDX", "mutual_fund", "IDR");
    const usStock = await mk(`${sub}-AAPL`, "US", "equity", "USD");
    const holderId = await createHolder(t, { name: "Mixed Holder" });
    const portfolioId = await createPortfolio(t, {
      baseCurrency: "IDR",
      accountHolderId: holderId,
    });
    const income = (payload: Record<string, unknown>) =>
      seedTransaction(app, portfolioId, auth(t), { quantity: "0", ...payload });
    // Domestic dividend: 10% of gross, self-paid (no withholding for residents).
    await income({
      type: "dividend",
      instrumentId: idxStock.id,
      price: "1000000",
      currency: "IDR",
      executedAt: "2025-04-10T00:00:00.000Z",
    });
    // Bond coupons: 10% final, withheld. One without a recorded withholding (estimated),
    // one net 425,000 with 75,000 recorded (the recorded figure wins over 10%).
    await income({
      type: "coupon",
      instrumentId: idrBond.id,
      price: "500000",
      currency: "IDR",
      executedAt: "2025-03-15T00:00:00.000Z",
    });
    await income({
      type: "coupon",
      instrumentId: idrBond.id,
      price: "425000",
      tax: "75000",
      currency: "IDR",
      executedAt: "2025-09-15T00:00:00.000Z",
    });
    // IDR cash interest: 20% final, withheld by the bank.
    await income({
      type: "interest",
      price: "200000",
      currency: "IDR",
      executedAt: "2025-06-30T00:00:00.000Z",
    });
    // Reksa dana distribution: not an income-tax object for the unit holder.
    await income({
      type: "dividend",
      instrumentId: reksaDana.id,
      price: "300000",
      currency: "IDR",
      executedAt: "2025-07-01T00:00:00.000Z",
    });
    // Foreign: US dividend net 100 USD + 15 USD US withholding; EUR interest 10 EUR.
    await income({
      type: "dividend",
      instrumentId: usStock.id,
      price: "100",
      tax: "15",
      currency: "USD",
      executedAt: "2025-05-15T00:00:00.000Z",
    });
    await income({
      type: "interest",
      price: "10",
      currency: "EUR",
      executedAt: "2025-12-31T00:00:00.000Z",
    });
    return { t, portfolioId };
  }

  function expectMixedYear(id: {
    income: IncomeRow[];
    incomeByCategory: Category[];
    totalIncomeGross: string;
    totalIncomeTax: string;
    foreignIncomeGross: string;
    foreignTaxWithheld: string;
    estimatedTax: string;
    taxWithheldAtSource: string;
    taxToSelfPay: string;
    byYear: { year: number; income: string; foreignIncome: string; tax: string }[];
  }) {
    const cat = (c: string) => id.incomeByCategory.find((x) => x.category === c);
    expect(cat("domestic_dividend")).toMatchObject({
      rate: "0.10",
      gross: "1000000.00",
      tax: "100000.00",
      withheldAtSource: false,
    });
    expect(cat("bond_interest")).toMatchObject({
      rate: "0.10",
      gross: "1000000.00",
      // 50,000 (10% of the unrecorded coupon) + 75,000 recorded.
      tax: "125000.00",
      withheldAtSource: true,
    });
    expect(cat("deposit_interest")).toMatchObject({
      rate: "0.20",
      gross: "200000.00",
      tax: "40000.00",
      withheldAtSource: true,
    });
    expect(cat("fund_distribution")).toMatchObject({
      rate: "0",
      gross: "300000.00",
      tax: "0.00",
    });
    // Foreign income: gross in IDR (115 USD × 16,000 + 10 EUR × 17,000), no final tax.
    expect(cat("foreign")).toMatchObject({ rate: null, gross: "2010000.00", tax: null });
    expect(id.foreignIncomeGross).toBe("2010000.00");
    expect(id.foreignTaxWithheld).toBe("240000.00");
    const us = id.income.find((r) => r.symbol.endsWith("-AAPL"))!;
    expect(us).toMatchObject({ category: "foreign", tax: null, foreignTaxWithheld: "240000.00" });
    const bond = id.income.find((r) => r.category === "bond_interest")!;
    expect(bond.taxBasis).toBe("mixed");
    // Cash interest (no instrument) is labelled by type and its own currency, never by
    // the bare type key — this payload is what the MCP/assistant tools pass through.
    expect(id.income.map((r) => r.symbol)).not.toContain("interest");
    expect(id.income.find((r) => r.category === "deposit_interest")).toMatchObject({
      symbol: "Cash interest · IDR",
      cashSource: { type: "interest", currency: "IDR" },
    });
    expect(id.income.find((r) => r.cashSource?.currency === "EUR")).toMatchObject({
      symbol: "Cash interest · EUR",
      category: "foreign",
      gross: "170000.00",
    });
    // Totals: only Indonesian income is in the final-tax estimate.
    expect(id.totalIncomeGross).toBe("2500000.00");
    expect(id.totalIncomeTax).toBe("265000.00");
    expect(id.estimatedTax).toBe("265000.00");
    expect(id.taxWithheldAtSource).toBe("165000.00");
    expect(id.taxToSelfPay).toBe("100000.00");
    const y2025 = id.byYear.find((y) => y.year === 2025)!;
    expect(y2025).toMatchObject({
      income: "2500000.00",
      foreignIncome: "2010000.00",
      tax: "265000.00",
    });
  }

  it("applies each income type's rate on /portfolios/:id/tax", async () => {
    const { t, portfolioId } = await seedMixedYear("tax-id-mix-1");
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expectMixedYear(res.json().indonesianFinalTax);
  });

  it("applies the same rates on /networth/tax (display currency IDR)", async () => {
    const { t } = await seedMixedYear("tax-id-mix-2");
    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const [entry] = res.json() as { indonesianFinalTax: Parameters<typeof expectMixedYear>[0] }[];
    expectMixedYear(entry!.indonesianFinalTax);
  });
});

describe("Indonesian income tax — cash interest follows the portfolio's country", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  type Cat = { category: string; gross: string; tax: string | null };

  /** One holder, three IDR portfolios: an Indonesian bank paying USD interest, a German
   *  bank paying IDR interest, and one with no country paying IDR interest. */
  async function seedCountries(sub: string) {
    const t = await token(sub);
    await setTaxRegime(t, "ID");
    await app.db
      .insert(fxRates)
      .values({ base: "USD", quote: "IDR", rate: "16000", date: toDateKey(new Date()) })
      .onConflictDoNothing();
    const holderId = await createHolder(t, { name: "Country Holder" });
    const interest = async (portfolioId: string, price: string, currency: string) =>
      seedTransaction(app, portfolioId, auth(t), {
        type: "interest",
        quantity: "0",
        price,
        currency,
        executedAt: "2025-06-30T00:00:00.000Z",
      });
    const idBank = await createPortfolio(t, {
      name: "ID bank",
      baseCurrency: "IDR",
      accountHolderId: holderId,
      country: "ID",
    });
    const deBank = await createPortfolio(t, {
      name: "DE bank",
      baseCurrency: "IDR",
      accountHolderId: holderId,
      country: "DE",
    });
    const unset = await createPortfolio(t, {
      name: "No country",
      baseCurrency: "IDR",
      accountHolderId: holderId,
    });
    await interest(idBank, "100", "USD"); // 1,600,000 IDR
    await interest(deBank, "500000", "IDR");
    await interest(unset, "100000", "IDR");
    return { t, idBank, deBank, unset };
  }

  const portfolioTax = async (t: string, portfolioId: string) => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    return res.json().indonesianFinalTax as { incomeByCategory: Cat[] };
  };

  it("taxes USD interest at an Indonesian bank as 20% final bank interest", async () => {
    const { t, idBank } = await seedCountries("tax-id-country-1");
    const id = await portfolioTax(t, idBank);
    expect(id.incomeByCategory).toEqual([
      expect.objectContaining({
        category: "deposit_interest",
        gross: "1600000.00",
        tax: "320000.00",
      }),
    ]);
  });

  it("reports IDR interest at a bank outside Indonesia as foreign income", async () => {
    const { t, deBank } = await seedCountries("tax-id-country-2");
    const id = await portfolioTax(t, deBank);
    expect(id.incomeByCategory).toEqual([
      expect.objectContaining({ category: "foreign", gross: "500000.00", tax: null }),
    ]);
  });

  it("falls back to the currency when the portfolio has no country", async () => {
    const { t, unset } = await seedCountries("tax-id-country-3");
    const id = await portfolioTax(t, unset);
    expect(id.incomeByCategory).toEqual([
      expect.objectContaining({
        category: "deposit_interest",
        gross: "100000.00",
        tax: "20000.00",
      }),
    ]);
  });

  it("classifies each portfolio's interest by its own country on /networth/tax", async () => {
    const { t } = await seedCountries("tax-id-country-4");
    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const [entry] = res.json() as {
      indonesianFinalTax: { incomeByCategory: Cat[]; foreignIncomeGross: string };
    }[];
    const cats = entry!.indonesianFinalTax.incomeByCategory;
    // ID bank (USD) + no country (IDR) are Indonesian; the DE bank's IDR interest is foreign.
    expect(cats).toEqual([
      expect.objectContaining({
        category: "deposit_interest",
        gross: "1700000.00",
        tax: "340000.00",
      }),
      expect.objectContaining({ category: "foreign", gross: "500000.00", tax: null }),
    ]);
    expect(entry!.indonesianFinalTax.foreignIncomeGross).toBe("500000.00");
  });
});

describe("Indonesian income tax — the Rp7.5M small-balance exemption for bank interest", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  type Row = {
    category: string;
    exemption: string | null;
    rate: string | null;
    gross: string;
    tax: string | null;
  };
  type IdTax = {
    income: Row[];
    incomeByCategory: { category: string; gross: string; exemptGross: string; tax: string }[];
    totalIncomeGross: string;
    estimatedTax: string;
  };

  /**
   * One holder, two Indonesian bank portfolios:
   * - "Small": Rp7,490,000 deposited; interest of 10,000 (balance before it 7,490,000) and
   *   20,000 (7,500,000 — exactly the threshold) is exempt, 30,000 (7,520,000) is taxed.
   * - "FX": Rp7,000,000 + USD 50 (Rp800,000 at 16,000): 7,800,000, so its interest is taxed
   *   although the rupiah balance alone would be exempt.
   */
  async function seed(sub: string) {
    const t = await token(sub);
    await setTaxRegime(t, "ID");
    for (const date of ["2025-01-01", toDateKey(new Date())]) {
      await app.db
        .insert(fxRates)
        .values({ base: "USD", quote: "IDR", rate: "16000", date })
        .onConflictDoNothing();
    }
    const holderId = await createHolder(t, { name: "Exemption Holder" });
    const cash = (portfolioId: string, type: string, price: string, currency: string, at: string) =>
      seedTransaction(app, portfolioId, auth(t), {
        type,
        quantity: "0",
        price,
        currency,
        executedAt: `${at}T00:00:00.000Z`,
      });
    const small = await createPortfolio(t, {
      name: "Small",
      baseCurrency: "IDR",
      accountHolderId: holderId,
      country: "ID",
    });
    await cash(small, "deposit", "7490000", "IDR", "2025-01-02");
    await cash(small, "interest", "10000", "IDR", "2025-01-31");
    await cash(small, "interest", "20000", "IDR", "2025-02-28");
    await cash(small, "interest", "30000", "IDR", "2025-03-31");
    const fx = await createPortfolio(t, {
      name: "FX",
      baseCurrency: "IDR",
      accountHolderId: holderId,
      country: "ID",
    });
    await cash(fx, "deposit", "7000000", "IDR", "2025-01-02");
    await cash(fx, "deposit", "50", "USD", "2025-01-03");
    await cash(fx, "interest", "5000", "IDR", "2025-01-31");
    return { t, small, fx };
  }

  const portfolioTax = async (headers: Record<string, string>, portfolioId: string) => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    return res.json().indonesianFinalTax as IdTax;
  };

  it("exempts interest on a balance up to Rp7.5M, taxes it above, and shows both", async () => {
    const { t, small } = await seed("tax-id-exempt-1");
    const id = await portfolioTax(auth(t), small);
    // Exempt and taxed payments of one source are two rows, each with its own rate.
    expect(id.income).toHaveLength(2);
    expect(id.income).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "deposit_interest",
          exemption: "small_balance",
          rate: "0",
          gross: "30000.00",
          tax: "0.00",
        }),
        expect.objectContaining({
          category: "deposit_interest",
          exemption: null,
          rate: "0.20",
          gross: "30000.00",
          tax: "6000.00",
        }),
      ]),
    );
    // Exempt interest stays in the gross, but adds nothing to the estimate.
    expect(id.totalIncomeGross).toBe("60000.00");
    expect(id.estimatedTax).toBe("6000.00");
    expect(id.incomeByCategory).toEqual([
      expect.objectContaining({
        category: "deposit_interest",
        gross: "60000.00",
        exemptGross: "30000.00",
        tax: "6000.00",
      }),
    ]);
  });

  it("counts a foreign-currency balance, converted to IDR, toward the threshold", async () => {
    const { t, fx } = await seed("tax-id-exempt-2");
    const id = await portfolioTax(auth(t), fx);
    expect(id.income).toEqual([
      expect.objectContaining({ exemption: null, gross: "5000.00", tax: "1000.00" }),
    ]);
  });

  it("judges each portfolio by its own balance on /networth/tax", async () => {
    const { t } = await seed("tax-id-exempt-3");
    const res = await app.inject({
      method: "GET",
      url: "/networth/tax?year=2025",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const [entry] = res.json() as { indonesianFinalTax: IdTax }[];
    expect(entry!.indonesianFinalTax.incomeByCategory).toEqual([
      expect.objectContaining({
        category: "deposit_interest",
        gross: "65000.00",
        exemptGross: "30000.00",
        tax: "7000.00",
      }),
    ]);
    expect(entry!.indonesianFinalTax.estimatedTax).toBe("7000.00");
  });

  it("taxes interest at 20% when a balance currency has no rate into IDR, and says so", async () => {
    const t = await token("tax-id-exempt-5");
    await setTaxRegime(t, "ID");
    const pf = await createPortfolio(t, { name: "No rate", baseCurrency: "IDR", country: "ID" });
    const cash = (type: string, price: string, currency: string, at: string) =>
      seedTransaction(app, pf, auth(t), {
        type,
        quantity: "0",
        price,
        currency,
        executedAt: `${at}T00:00:00.000Z`,
      });
    // Rp1M is small, but the CHF balance can't be converted: the total is unknown.
    await cash("deposit", "1000000", "IDR", "2025-01-02");
    await cash("deposit", "100", "CHF", "2025-01-03");
    await cash("interest", "5000", "IDR", "2025-01-31");
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { indonesianFinalTax: IdTax; fxMissingCurrencies?: string[] };
    expect(body.indonesianFinalTax.income).toEqual([
      expect.objectContaining({ exemption: null, gross: "5000.00", tax: "1000.00" }),
    ]);
    expect(body.fxMissingCurrencies).toContain("CHF");
  });

  it("applies the exemption for a read-scoped token from cached FX rates", async () => {
    const { t, small, fx } = await seed("tax-id-exempt-4");
    const minted = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(t),
      payload: { name: "ro", scope: "read" },
    });
    expect(minted.statusCode).toBe(201);
    const pat = { authorization: `Bearer ${minted.json().token as string}` };
    expect((await portfolioTax(pat, small)).estimatedTax).toBe("6000.00");
    expect((await portfolioTax(pat, fx)).estimatedTax).toBe("1000.00");
  });
});

describe("Indonesian bond and sukuk discount", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  type Income = {
    category: string;
    rate: string | null;
    gross: string;
    tax: string | null;
    exemption: string | null;
    taxBasis: string | null;
    withheldAtSource: boolean;
  };
  type IdTax = {
    disposals: unknown[];
    income: Income[];
    totalSalesTax: string;
    totalIncomeTax: string;
    estimatedTax: string;
    taxWithheldAtSource: string;
    byYear: { year: number; tax: string }[];
  };

  async function book(sub: string) {
    const t = await token(sub);
    await setTaxRegime(t, "ID");
    const portfolioId = await createPortfolio(t, {
      baseCurrency: "IDR",
      country: "ID",
    });
    return { t, portfolioId, headers: auth(t) };
  }

  async function mkBond(symbol: string, market: string, maturityDate?: string) {
    const [row] = await app.db
      .insert(instruments)
      .values({
        symbol,
        market,
        assetClass: "bond" as "equity",
        currency: "IDR",
        name: symbol,
        ...(maturityDate ? { maturityDate } : {}),
      })
      .returning();
    return row!;
  }

  async function taxOf(headers: Record<string, string>, portfolioId: string, year: number) {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=${year}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    return res.json().indonesianFinalTax as IdTax;
  }

  it("taxes coupons only when a bond is redeemed at par", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-par");
    const bond = await mkBond("ORI020-PAR", "IDX");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2024-02-01T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "coupon",
      instrumentId: bond.id,
      quantity: "0",
      price: "50000",
      currency: "IDR",
      executedAt: "2025-03-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2025-08-15T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.disposals).toEqual([]);
    expect(id.totalSalesTax).toBe("0.00");
    expect(id.income.map((r) => r.category)).toEqual(["bond_interest"]);
    expect(id.income[0]).toMatchObject({ gross: "50000.00", tax: "5000.00" });
    expect(id.estimatedTax).toBe("5000.00");
  });

  it("taxes a sale above clean cost at 10% of the discount, fees excluded, not at 0.1%", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-up");
    const bond = await mkBond("ORI020-UP", "IDX");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      fees: "5000",
      currency: "IDR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "1010000",
      fees: "2000",
      currency: "IDR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    // 10,000 discount × 10%. Not 0.1% of 1,010,000, and not reduced by the 5,000 buy fee.
    expect(id.disposals).toEqual([]);
    expect(id.totalSalesTax).toBe("0.00");
    expect(id.income).toEqual([
      expect.objectContaining({
        category: "bond_discount",
        gross: "10000.00",
        tax: "1000.00",
        rate: "0.10",
        exemption: null,
        taxBasis: "estimated",
        withheldAtSource: true,
      }),
    ]);
    expect(id.estimatedTax).toBe("1000.00");
    expect(id.taxWithheldAtSource).toBe("1000.00");
    expect(id.byYear.find((y) => y.year === 2025)?.tax).toBe("1000.00");
  });

  it("uses a withholding recorded on the sell instead of 10%", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-recorded");
    const bond = await mkBond("ORI020-REC", "IDX");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "1010000",
      tax: "2500",
      currency: "IDR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.income[0]).toMatchObject({
      category: "bond_discount",
      tax: "2500.00",
      taxBasis: "recorded",
    });
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("does not let a sale below cost produce a negative tax or reduce an earlier coupon", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-down");
    const bond = await mkBond("ORI020-DOWN", "IDX");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2024-06-01T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "coupon",
      instrumentId: bond.id,
      quantity: "0",
      price: "100000",
      currency: "IDR",
      executedAt: "2025-02-01T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "990000",
      currency: "IDR",
      executedAt: "2025-09-01T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.income.find((r) => r.category === "bond_interest")).toMatchObject({
      tax: "10000.00",
    });
    expect(id.income.find((r) => r.category === "bond_discount")).toMatchObject({
      gross: "-10000.00",
      tax: "0.00",
      exemption: "negative_discount",
      rate: "0",
    });
    expect(id.estimatedTax).toBe("10000.00");
    expect(id.totalIncomeTax).toBe("10000.00");
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("uses 15% when the sale is before 30 Aug 2021 and no tax was recorded", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-15");
    const bond = await mkBond("ORI020-15", "IDX");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2020-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "1010000",
      currency: "IDR",
      executedAt: "2021-08-01T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2021);
    expect(id.income[0]).toMatchObject({
      category: "bond_discount",
      rate: "0.15",
      tax: "1500.00",
      taxBasis: "estimated",
    });
    expect(id.byYear.find((y) => y.year === 2021)?.tax).toBe("1500.00");
    expect(id.disposals).toEqual([]);
  });

  it("skips paper maturing within a year of purchase", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-spn");
    const bond = await mkBond("SPN-1", "SBN", "2025-12-01");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2025-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "1010000",
      currency: "IDR",
      executedAt: "2025-06-15T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.income).toEqual([]);
    expect(id.disposals).toEqual([]);
    expect(id.estimatedTax).toBe("0.00");
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("taxes an SBN bond's discount and coupon, and not as an IDX share sale", async () => {
    const { portfolioId, headers } = await book("tax-id-bond-sbn");
    const bond = await mkBond("SBN-ORI", "SBN");
    const foreign = await mkBond("BUND", "XETRA");
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: bond.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2024-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "coupon",
      instrumentId: bond.id,
      quantity: "0",
      price: "20000",
      currency: "IDR",
      executedAt: "2025-04-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: bond.id,
      quantity: "1",
      price: "1010000",
      currency: "IDR",
      executedAt: "2025-07-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId: foreign.id,
      quantity: "1",
      price: "1000000",
      currency: "IDR",
      executedAt: "2024-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId: foreign.id,
      quantity: "1",
      price: "1010000",
      currency: "IDR",
      executedAt: "2025-07-15T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.disposals).toEqual([]);
    expect(id.totalSalesTax).toBe("0.00");
    expect(id.income.find((r) => r.category === "bond_interest")).toMatchObject({
      tax: "2000.00",
    });
    expect(id.income.filter((r) => r.category === "bond_discount")).toEqual([
      expect.objectContaining({ gross: "10000.00", tax: "1000.00", rate: "0.10" }),
    ]);
    expect(id.estimatedTax).toBe("3000.00");
  });
});

describe("Indonesian crypto sales tax by venue", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  async function book(
    sub: string,
    opts: { country?: string | null; cryptoTaxVenue?: "domestic" | "foreign" | null } = {},
  ) {
    const t = await token(sub);
    await setTaxRegime(t, "ID");
    const portfolioId = await createPortfolio(t, {
      baseCurrency: "IDR",
      country: opts.country ?? null,
      cryptoTaxVenue: opts.cryptoTaxVenue ?? null,
    });
    const [coin] = await app.db
      .insert(instruments)
      .values({
        symbol: `${sub}-BTC`,
        market: "CCC",
        assetClass: "crypto" as "equity",
        currency: "IDR",
        name: "Bitcoin",
      })
      .returning();
    return { portfolioId, headers: auth(t), coin: coin! };
  }

  async function taxOf(headers: Record<string, string>, portfolioId: string, year: number) {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=${year}`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    return res.json().indonesianFinalTax as {
      disposals: unknown[];
      totalSalesTax: string;
      totalCryptoTax: string;
      totalCryptoProceeds: string;
      estimatedTax: string;
      taxWithheldAtSource: string;
      cryptoDisposals: {
        rate: string | null;
        tax: string;
        venue: string;
        taxBasis: string | null;
      }[];
    };
  }

  async function roundTrip(
    headers: Record<string, string>,
    portfolioId: string,
    instrumentId: string,
    sell: { price: string; at: string; fees?: string; tax?: string },
    buyPrice = "1000000",
  ) {
    await seedTransaction(app, portfolioId, headers, {
      type: "buy",
      instrumentId,
      quantity: "1",
      price: buyPrice,
      currency: "IDR",
      executedAt: "2024-01-15T00:00:00.000Z",
    });
    await seedTransaction(app, portfolioId, headers, {
      type: "sell",
      instrumentId,
      quantity: "1",
      price: sell.price,
      currency: "IDR",
      fees: sell.fees,
      tax: sell.tax,
      executedAt: sell.at,
    });
  }

  it("taxes a domestic sale on 2025-08-01 at 0.21% of gross, not as a share sale", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-dom", {
      cryptoTaxVenue: "domestic",
    });
    await roundTrip(headers, portfolioId, coin.id, {
      price: "1000000",
      at: "2025-08-01T00:00:00.000Z",
      fees: "5000",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.disposals).toEqual([]);
    expect(id.totalSalesTax).toBe("0.00");
    expect(id.totalCryptoProceeds).toBe("1000000.00");
    expect(id.totalCryptoTax).toBe("2100.00");
    expect(id.cryptoDisposals[0]).toMatchObject({
      rate: "0.0021",
      venue: "domestic",
      taxBasis: "estimated",
    });
    expect(id.estimatedTax).toBe("2100.00");
    expect(id.taxWithheldAtSource).toBe("2100.00");
  });

  it("uses 0.10% on 2025-07-31", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-jul", {
      cryptoTaxVenue: "domestic",
    });
    await roundTrip(headers, portfolioId, coin.id, {
      price: "1000000",
      at: "2025-07-31T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.totalCryptoTax).toBe("1000.00");
    expect(id.cryptoDisposals[0]!.rate).toBe("0.001");
  });

  it("uses 1% for a foreign venue on 2025-08-01", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-for", {
      country: "ID",
      cryptoTaxVenue: "foreign",
    });
    await roundTrip(headers, portfolioId, coin.id, {
      price: "1000000",
      at: "2025-08-01T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.totalCryptoTax).toBe("10000.00");
    expect(id.cryptoDisposals[0]).toMatchObject({ venue: "foreign", rate: "0.01" });
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("estimates nothing when the venue is unset and the country is not Indonesia", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-de", { country: "DE" });
    await roundTrip(headers, portfolioId, coin.id, {
      price: "1000000",
      at: "2025-08-01T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.cryptoDisposals).toEqual([]);
    expect(id.totalCryptoTax).toBe("0.00");
    expect(id.estimatedTax).toBe("0.00");
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("treats an Indonesian portfolio with no venue as domestic", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-id", { country: "ID" });
    await roundTrip(headers, portfolioId, coin.id, {
      price: "1000000",
      at: "2025-08-01T00:00:00.000Z",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.totalCryptoTax).toBe("2100.00");
    expect(id.cryptoDisposals[0]!.venue).toBe("domestic");
  });

  it("taxes a losing sale on the gross proceeds", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-loss", {
      cryptoTaxVenue: "domestic",
    });
    await roundTrip(
      headers,
      portfolioId,
      coin.id,
      { price: "1000000", at: "2025-08-01T00:00:00.000Z", fees: "5000" },
      "2000000",
    );
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.totalCryptoProceeds).toBe("1000000.00");
    expect(id.totalCryptoTax).toBe("2100.00");
  });

  it("lets a withholding recorded on the sell win", async () => {
    const { portfolioId, headers, coin } = await book("tax-id-crypto-rec", {
      cryptoTaxVenue: "domestic",
    });
    await roundTrip(headers, portfolioId, coin.id, {
      price: "1000000",
      at: "2025-08-01T00:00:00.000Z",
      tax: "50",
    });
    const id = await taxOf(headers, portfolioId, 2025);
    expect(id.cryptoDisposals[0]).toMatchObject({ tax: "50.00", taxBasis: "recorded" });
    expect(id.estimatedTax).toBe("50.00");
  });
});
