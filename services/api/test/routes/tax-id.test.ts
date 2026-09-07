import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments } from "@portfolio/db";
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
    expect(body.indonesianFinalTax.totalDividendGross).toBe("0.00");
    expect(body.indonesianFinalTax.totalDividendTax).toBe("0.00");
    expect(body.indonesianFinalTax.totalDividendNet).toBe("0.00");
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
    // Dividend recorded as a lump-sum (qty=0): price=200 is the gross dividend.
    // ID's 10% dividend tax is calculated on gross (the function ignores whatever the
    // broker recorded as `tax` — see tax-id.ts' design-fidelity note).
    expect(id.totalDividendGross).toBe("200.00");
    expect(id.totalDividendTax).toBe("20.00");
    expect(id.totalDividendNet).toBe("180.00");
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
