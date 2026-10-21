import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { fxRates, instruments } from "@portfolio/db";
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

async function setTaxRegime(t: string) {
  const res = await app.inject({
    method: "PUT",
    url: "/me/preferences",
    headers: auth(t),
    payload: { taxRegime: "ID" },
  });
  expect(res.statusCode).toBe(200);
}

async function createPortfolio(t: string, opts: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name: "ID book", baseCurrency: "IDR", ...opts },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function instrument(
  symbol: string,
  market: string,
  assetClass: "gold" | "etf",
  currency: string,
) {
  const [row] = await app.db
    .insert(instruments)
    .values({ symbol, market, assetClass, currency, name: symbol })
    .returning();
  return row!;
}

async function sell(
  t: string,
  portfolioId: string,
  instrumentId: string,
  price: string,
  when: string,
  opts: { tax?: string; currency?: string } = {},
) {
  const res = await app.inject({
    method: "POST",
    url: `/portfolios/${portfolioId}/transactions`,
    headers: auth(t),
    payload: {
      type: "sell",
      instrumentId,
      quantity: "1",
      price,
      currency: opts.currency ?? "IDR",
      executedAt: `${when}T00:00:00.000Z`,
      ...(opts.tax !== undefined ? { tax: opts.tax } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function taxOf(t: string, portfolioId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/portfolios/${portfolioId}/tax?year=2025`,
    headers: auth(t),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().indonesianFinalTax as {
    goldDisposals: { tax: string; taxBasis: string; rate: string | null }[];
    totalGoldTax: string;
    totalGoldProceeds: string;
    totalSalesTax: string;
    estimatedTax: string;
    taxToSelfPay: string;
    taxWithheldAtSource: string;
    income: { category: string; tax: string | null; rate: string | null }[];
  };
}

describe("Indonesian tax — gold-bar PPh 22", () => {
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

  it("charges nothing at exactly Rp10,000,000 and 0.25% one rupiah over", async () => {
    const t = await token("id-gold-threshold");
    await setTaxRegime(t);
    const at = await createPortfolio(t);
    const overBook = await createPortfolio(t);
    const bar = await instrument("LM-AT", "XAU", "gold", "IDR");
    const over = await instrument("LM-OVER", "XAU", "gold", "IDR");
    await sell(t, at, bar.id, "10000000", "2025-08-01");
    await sell(t, overBook, over.id, "10000001", "2025-08-01");

    const zero = await taxOf(t, at);
    expect(zero.goldDisposals).toEqual([]);
    expect(zero.totalGoldTax).toBe("0.00");
    expect(zero.estimatedTax).toBe("0.00");
    expect(zero.taxToSelfPay).toBe("0.00");
    expect(zero.totalSalesTax).toBe("0.00");

    const taxed = await taxOf(t, overBook);
    expect(taxed.goldDisposals[0]).toMatchObject({
      tax: "25000.00",
      rate: "0.0025",
      taxBasis: "estimated",
    });
    expect(taxed.totalGoldTax).toBe("25000.00");
    expect(taxed.totalGoldProceeds).toBe("10000001.00");
    expect(taxed.estimatedTax).toBe("0.00");
    expect(taxed.taxWithheldAtSource).toBe("0.00");
    expect(taxed.taxToSelfPay).toBe("0.00");
    expect(taxed.totalSalesTax).toBe("0.00");
  });

  it("uses a recorded withholding and still shows one from before 1 Aug 2025", async () => {
    const t = await token("id-gold-recorded");
    await setTaxRegime(t);
    const portfolioId = await createPortfolio(t);
    const bar = await instrument("LM-REC", "XAU", "gold", "IDR");
    await sell(t, portfolioId, bar.id, "20000000", "2025-09-01", { tax: "1000" });
    const usage = await taxOf(t, portfolioId);
    expect(usage.goldDisposals[0]).toMatchObject({
      tax: "1000.00",
      rate: null,
      taxBasis: "recorded",
    });
    expect(usage.totalGoldTax).toBe("1000.00");
    expect(usage.estimatedTax).toBe("0.00");

    const earlyBook = await createPortfolio(t);
    const early = await instrument("LM-EARLY-REC", "XAU", "gold", "IDR");
    await sell(t, earlyBook, early.id, "20000000", "2025-07-31", { tax: "80" });
    const shown = await taxOf(t, earlyBook);
    expect(shown.goldDisposals[0]).toMatchObject({ tax: "80.00", taxBasis: "recorded" });
    expect(shown.estimatedTax).toBe("0.00");
  });

  it("does not estimate a sale on 31 Jul 2025", async () => {
    const t = await token("id-gold-before");
    await setTaxRegime(t);
    const portfolioId = await createPortfolio(t);
    const bar = await instrument("LM-BEFORE", "XAU", "gold", "IDR");
    await sell(t, portfolioId, bar.id, "20000000", "2025-07-31");
    const id = await taxOf(t, portfolioId);
    expect(id.goldDisposals).toEqual([]);
    expect(id.totalGoldTax).toBe("0.00");
    expect(id.estimatedTax).toBe("0.00");
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("leaves a gold ETF as a fund distribution and not an IDX or gold sale", async () => {
    const t = await token("id-gold-etf");
    await setTaxRegime(t);
    const portfolioId = await createPortfolio(t);
    const fund = await instrument("XAUM", "IDX", "etf", "IDR");
    await sell(t, portfolioId, fund.id, "20000000", "2025-09-01");
    await app.inject({
      method: "POST",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
      payload: {
        type: "dividend",
        instrumentId: fund.id,
        quantity: "0",
        price: "100000",
        currency: "IDR",
        executedAt: "2025-06-01T00:00:00.000Z",
      },
    });
    const id = await taxOf(t, portfolioId);
    expect(id.goldDisposals).toEqual([]);
    expect(id.totalSalesTax).toBe("0.00");
    expect(id.totalGoldTax).toBe("0.00");
    expect(id.income.find((r) => r.category === "fund_distribution")).toMatchObject({
      rate: "0",
      tax: "0.00",
    });
    expect(id.estimatedTax).toBe("0.00");
  });

  it("does not tax a gold sale that is not Indonesian", async () => {
    const t = await token("id-gold-foreign");
    await setTaxRegime(t);
    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR", country: "DE" });
    const bar = await instrument("XAU-DE", "XAU", "gold", "EUR");
    await sell(t, portfolioId, bar.id, "5000", "2025-09-01", { currency: "EUR" });
    const id = await taxOf(t, portfolioId);
    expect(id.goldDisposals).toEqual([]);
    expect(id.totalGoldTax).toBe("0.00");
    expect(id.totalSalesTax).toBe("0.00");
  });

  it("converts a euro sale in an Indonesian portfolio at the sale date for the rupiah test", async () => {
    const t = await token("id-gold-eur");
    await setTaxRegime(t);
    await app.db.insert(fxRates).values({
      base: "EUR",
      quote: "IDR",
      rate: "17000",
      date: "2025-08-01",
    });
    const portfolioId = await createPortfolio(t, { baseCurrency: "EUR", country: "ID" });
    const bar = await instrument("LM-EUR", "XAU", "gold", "EUR");
    await sell(t, portfolioId, bar.id, "1000", "2025-08-01", { currency: "EUR" });
    const id = await taxOf(t, portfolioId);
    // 1,000 EUR × 17,000 = Rp17,000,000, over the threshold. 0.25% of the euro gross.
    expect(id.goldDisposals[0]).toMatchObject({
      tax: "2.50",
      rate: "0.0025",
      taxBasis: "estimated",
    });
    expect(id.totalGoldProceeds).toBe("1000.00");
    expect(id.totalGoldTax).toBe("2.50");
    expect(id.estimatedTax).toBe("0.00");
    expect(id.taxToSelfPay).toBe("0.00");
  });

  it("drops a non-rupiah sale when the IDR rate is missing and still shows a recorded tax", async () => {
    const t = await token("id-gold-fx-miss");
    await setTaxRegime(t);
    const portfolioId = await createPortfolio(t, { baseCurrency: "CHF", country: "ID" });
    const bar = await instrument("LM-MISS", "XAU", "gold", "CHF");
    await sell(t, portfolioId, bar.id, "1000", "2025-09-01", { currency: "CHF" });
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2025`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      indonesianFinalTax: { goldDisposals: unknown[]; totalGoldTax: string };
      fxMissingCurrencies?: string[];
    };
    expect(body.indonesianFinalTax.goldDisposals).toEqual([]);
    expect(body.indonesianFinalTax.totalGoldTax).toBe("0.00");
    expect(body.fxMissingCurrencies).toContain("CHF");

    const recordedBook = await createPortfolio(t, { baseCurrency: "CHF", country: "ID" });
    const recorded = await instrument("LM-CHF-REC", "XAU", "gold", "CHF");
    await sell(t, recordedBook, recorded.id, "1000", "2025-09-02", {
      currency: "CHF",
      tax: "3",
    });
    const shown = await taxOf(t, recordedBook);
    expect(shown.goldDisposals[0]).toMatchObject({ tax: "3.00", taxBasis: "recorded" });
    expect(shown.estimatedTax).toBe("0.00");
  });
});
