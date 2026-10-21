import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, transactionSources } from "@portfolio/db";
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

async function createHolder(t: string, opts: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/account-holders",
    headers: auth(t),
    payload: { name: "DE Holder", type: "self", taxAllowanceAnnual: "1000", ...opts },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function createPortfolio(t: string, holderId: string, allowance = "0") {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: {
      name: "DE book",
      baseCurrency: "EUR",
      accountHolderId: holderId,
      taxAllowanceAnnual: allowance,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function instrument(symbol: string, market: string, assetClass = "equity") {
  const [row] = await app.db
    .insert(instruments)
    .values({ symbol, market, assetClass: assetClass as "equity", currency: "EUR", name: symbol })
    .returning();
  return row!;
}

async function dividend(
  t: string,
  portfolioId: string,
  instrumentId: string,
  price: string,
  tax: string,
) {
  const res = await app.inject({
    method: "POST",
    url: `/portfolios/${portfolioId}/transactions`,
    headers: auth(t),
    payload: {
      type: "dividend",
      instrumentId,
      quantity: "0",
      price,
      tax,
      currency: "EUR",
      executedAt: "2025-06-01T00:00:00.000Z",
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function taxOf(t: string, portfolioId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/portfolios/${portfolioId}/tax?year=2025`,
    headers: auth(t),
  });
  expect(res.statusCode).toBe(200);
  return res.json().allowanceUsage as {
    foreignTaxCredit: string;
    estimatedTax: string;
    taxableExcess: string;
    taxRate: string;
  };
}

describe("German estimate — foreign withholding credit", () => {
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

  it("credits an IDX dividend's recorded tax and does not invent a rate", async () => {
    const t = await token("de-credit-idx");
    const holderId = await createHolder(t, { capitalGainsTaxRate: "0.25" });
    const portfolioId = await createPortfolio(t, holderId);
    const idx = await instrument("IDX-DE-CREDIT", "IDX");
    // Net 90 + tax 10 = gross 100. 25% German tax is 25; the credit is the recorded 10.
    await dividend(t, portfolioId, idx.id, "90", "10");
    const usage = await taxOf(t, portfolioId);
    expect(usage.taxableExcess).toBe("100.00");
    expect(usage.foreignTaxCredit).toBe("10.00");
    expect(usage.estimatedTax).toBe("15.00");
  });

  it("does not credit Kapitalertragsteuer on a German share", async () => {
    const t = await token("de-credit-kapst");
    const holderId = await createHolder(t, { capitalGainsTaxRate: "0.25" });
    const portfolioId = await createPortfolio(t, holderId);
    const share = await instrument("DE-KAPST", "XETRA");
    const tx = await dividend(t, portfolioId, share.id, "90", "10");
    await app.db.insert(transactionSources).values({
      transactionId: tx.id,
      sourceType: "pdf",
      taxComponents: { kapitalertragsteuer: "10.00" },
    });
    const usage = await taxOf(t, portfolioId);
    expect(usage.foreignTaxCredit).toBe("0.00");
    expect(usage.estimatedTax).toBe("25.00");
  });

  it("credits Quellensteuer and ignores Kapitalertragsteuer on the same row", async () => {
    const t = await token("de-credit-qst");
    const holderId = await createHolder(t, { capitalGainsTaxRate: "0.25" });
    const portfolioId = await createPortfolio(t, holderId);
    const share = await instrument("US-QST", "US");
    const tx = await dividend(t, portfolioId, share.id, "100", "40");
    await app.db.insert(transactionSources).values({
      transactionId: tx.id,
      sourceType: "pdf",
      taxComponents: { quellensteuer: "15.00", kapitalertragsteuer: "25.00" },
    });
    const usage = await taxOf(t, portfolioId);
    // Gross 140. German tax 35. Credit is the 15 of Quellensteuer, not 40.
    expect(usage.taxableExcess).toBe("140.00");
    expect(usage.foreignTaxCredit).toBe("15.00");
    expect(usage.estimatedTax).toBe("20.00");
  });

  it("caps the credit at 25% of the gross and at the German tax for the year", async () => {
    const t = await token("de-credit-cap");
    const holderId = await createHolder(t, { capitalGainsTaxRate: "0.25" });
    const portfolioId = await createPortfolio(t, holderId);
    const idx = await instrument("IDX-DE-CAP", "IDX");
    // Gross 40, recorded tax 16, row cap 25% = 10. A 1,000 gain keeps the year tax above that.
    await app.inject({
      method: "POST",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
      payload: {
        type: "buy",
        instrumentId: idx.id,
        quantity: "10",
        price: "100",
        currency: "EUR",
        executedAt: "2025-01-15T00:00:00.000Z",
      },
    });
    await app.inject({
      method: "POST",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
      payload: {
        type: "sell",
        instrumentId: idx.id,
        quantity: "10",
        price: "200",
        currency: "EUR",
        executedAt: "2025-06-15T00:00:00.000Z",
      },
    });
    await dividend(t, portfolioId, idx.id, "24", "16");
    const capped = await taxOf(t, portfolioId);
    // Excess = 1,000 gain + 40 gross. Tax 260 before a credit of 10, not 16.
    expect(capped.taxableExcess).toBe("1040.00");
    expect(capped.foreignTaxCredit).toBe("10.00");
    expect(capped.estimatedTax).toBe("250.00");

    const t2 = await token("de-credit-year");
    const holder2 = await createHolder(t2, { capitalGainsTaxRate: "0.25" });
    const covered = await createPortfolio(t2, holder2, "1000");
    const idx2 = await instrument("IDX-DE-YEAR", "IDX");
    await dividend(t2, covered, idx2.id, "900", "100");
    const yearCap = await taxOf(t2, covered);
    expect(yearCap.taxableExcess).toBe("0.00");
    expect(yearCap.foreignTaxCredit).toBe("0.00");
    expect(yearCap.estimatedTax).toBe("0.00");
  });

  it("recomputes Solidaritätszuschlag when the rate is the statutory 26.375%", async () => {
    const t = await token("de-credit-soli");
    const holderId = await createHolder(t);
    const portfolioId = await createPortfolio(t, holderId);
    const idx = await instrument("IDX-DE-SOLI", "IDX");
    await dividend(t, portfolioId, idx.id, "90", "10");
    const usage = await taxOf(t, portfolioId);
    expect(usage.taxRate).toBe("0.26375");
    expect(usage.foreignTaxCredit).toBe("10.00");
    // KapESt 25 − 10 = 15, Soli 5.5% → 15.825.
    expect(usage.estimatedTax).toBe("15.83");
  });
});
