import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// Covers B6 — `computeConvertedSummary` SQL aggregates total income as
// `price * quantity`, but for `interest` and `bonus_cash` rows the amount lives
// in `price` (lump sum, quantity = 0). The naive SUM silently drops those
// rows from `totalIncome`, while `cashFlow` returns `price` for them — so the
// JS totals and the SQL summary disagreed. Mirror the JS switch:
//   interest / bonus_cash → price
//   dividend / coupon     → price * quantity
//   tax                   → -(price * quantity)  (defense: not income)

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

describe("transactions summary — income-type SQL branches (B6)", () => {
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
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  async function createPortfolio(t: string, name: string) {
    const res = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name, baseCurrency: "EUR" },
    });
    return res.json().id as string;
  }

  async function postTx(t: string, portfolioId: string, payload: Record<string, unknown>) {
    const res = await app.inject({
      method: "POST",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
      payload: { executedAt: "2026-03-03T00:00:00.000Z", ...payload },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  it("interest rows (qty=0, lump sum in price) are counted in totalIncome", async () => {
    const t = await token("summary-income-interest-user");
    const portfolioId = await createPortfolio(t, "Interest book");

    // Interest is always a lump sum: instrument is null, qty is 0, price carries the amount.
    // The previous SQL `price * quantity` returned 0 for these rows — silent undercount.
    await postTx(t, portfolioId, {
      type: "interest",
      instrumentId: null,
      quantity: "0",
      price: "50",
      currency: "EUR",
    });
    await postTx(t, portfolioId, {
      type: "interest",
      instrumentId: null,
      quantity: "0",
      price: "12.34",
      currency: "EUR",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().summary as { totalIncome: string };
    expect(summary.totalIncome).toBe("62.34");
  });

  it("bonus_cash rows (qty=0, lump sum in price) are counted in totalIncome", async () => {
    const t = await token("summary-income-bonus-cash-user");
    const portfolioId = await createPortfolio(t, "Bonus cash book");

    // TR Kindergeld / promo bonus — same shape as interest.
    await postTx(t, portfolioId, {
      type: "bonus_cash",
      instrumentId: null,
      quantity: "0",
      price: "22.86",
      currency: "EUR",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().summary as { totalIncome: string };
    expect(summary.totalIncome).toBe("22.86");
  });

  it("dividend rows (qty>0) still total price * quantity (no regression on the existing case)", async () => {
    const t = await token("summary-income-dividend-user");
    const portfolioId = await createPortfolio(t, "Dividend book");

    // Pre-create an instrument so the dividend can hang off it.
    const insRes = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "DIVI",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Divi",
      },
    });
    const instrumentId = insRes.json().id as string;

    await postTx(t, portfolioId, {
      type: "dividend",
      instrumentId,
      quantity: "10",
      price: "2",
      currency: "EUR",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().summary as { totalIncome: string };
    expect(summary.totalIncome).toBe("20"); // 10 * 2 unchanged
  });

  it("tax rows (lump-sum debit in price, qty is irrelevant) contribute -price regardless of qty (Hermes #3)", async () => {
    // Mirror packages/core/src/cash.ts cashFlow() for the `tax` branch: magnitude
    // lives in `price` (it's a standalone debit, not a per-share amount), so the
    // SQL aggregate must subtract `price` rather than `price * quantity`. The
    // previous `-price * quantity` over-deducted when qty was non-zero (a Vorab
    // row imported with qty=1 would multiply the deduction by 1; harmless today
    // because importers leave qty=0, but fragile against a future importer
    // change). With qty=1 and price=10 the expected totalIncome contribution is
    // -10, not -10*1 (which happens to coincide by luck) — distinguish by using
    // qty=2 so the broken and fixed formulas give different answers.
    const t = await token("summary-income-tax-user");
    const portfolioId = await createPortfolio(t, "Tax book");

    await postTx(t, portfolioId, {
      type: "tax",
      instrumentId: null,
      quantity: "2", // would multiply the deduction by 2 if qty were applied
      price: "10",
      currency: "EUR",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/transactions?page=1&pageSize=25`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().summary as { totalIncome: string };
    expect(summary.totalIncome).toBe("-10"); // cashFlow() of `tax` is -price = -10
  });
});
