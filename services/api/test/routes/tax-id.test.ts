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
