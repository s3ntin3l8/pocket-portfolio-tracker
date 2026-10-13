import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { instruments, prices, transactions } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { clearValuationCache } from "../../src/services/valuation.js";

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

async function setup(sub: string, symbol: string, withPrices = true) {
  const t = await token(sub);
  await app.inject({ method: "GET", url: "/me", headers: auth(t) });
  const [fund] = await app.db
    .insert(instruments)
    .values({ symbol, market: "XETRA", assetClass: "etf", currency: "EUR", name: symbol })
    .returning();
  if (withPrices) {
    await app.db.insert(prices).values([
      { instrumentId: fund!.id, date: "2025-01-01", close: "100", currency: "EUR" },
      { instrumentId: fund!.id, date: "2025-12-31", close: "110", currency: "EUR" },
    ]);
  }
  const holder = await app.inject({
    method: "POST",
    url: "/account-holders",
    headers: auth(t),
    payload: { name: "H", type: "self", taxAllowanceAnnual: "1000", taxResidence: "DE" },
  });
  const pf = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: {
      name: "P",
      baseCurrency: "EUR",
      accountHolderId: holder.json().id,
      taxAllowanceAnnual: "1000",
    },
  });
  const portfolioId = pf.json().id as string;
  const buy = await app.inject({
    method: "POST",
    url: `/portfolios/${portfolioId}/transactions`,
    headers: auth(t),
    payload: {
      type: "buy",
      instrumentId: fund!.id,
      quantity: "10",
      price: "90",
      currency: "EUR",
      executedAt: "2024-06-03T00:00:00.000Z",
    },
  });
  expect(buy.statusCode).toBe(201);
  return { t, fund: fund!, portfolioId };
}

describe("tax route: estimated Vorabpauschale", () => {
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

  it("books an estimate for a fund held across a finished year, flagged as estimated", async () => {
    const { t, portfolioId } = await setup("vorab-est-1", "VORAB-A");
    // 2025: 10 units x min(100 x 2.53% x 70%, 10) = 17.71, deemed received 2 Jan 2026;
    // 30% Teilfreistellung (ETF default) => 12.40 in the 2026 allowance figures.
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2026`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const u = res.json().allowanceUsage;
    expect(u.vorabpauschaleAccrued).toBe("12.40");
    expect(u.vorabpauschaleEstimated).toBe(true);
  });

  it("estimates nothing without year-boundary prices (never a zero or guessed base)", async () => {
    const { t, portfolioId } = await setup("vorab-est-2", "VORAB-B", false);
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2026`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().allowanceUsage.vorabpauschaleAccrued).toBe("0.00");
    expect(res.json().allowanceUsage.vorabpauschaleEstimated).toBeUndefined();
  });

  it("a year-end close older than the 5-day lookback is a miss, not carried forward", async () => {
    const { t, fund, portfolioId } = await setup("vorab-est-4", "VORAB-D", false);
    await app.db.insert(prices).values([
      { instrumentId: fund.id, date: "2025-01-01", close: "100", currency: "EUR" },
      { instrumentId: fund.id, date: "2025-12-20", close: "110", currency: "EUR" },
    ]);
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2026`,
      headers: auth(t),
    });
    expect(res.json().allowanceUsage.vorabpauschaleAccrued).toBe("0.00");
  });

  it("a broker-booked Vorabpauschale for the year replaces the estimate", async () => {
    const { t, fund, portfolioId } = await setup("vorab-est-3", "VORAB-C");
    const created = await app.inject({
      method: "POST",
      url: `/portfolios/${portfolioId}/transactions`,
      headers: auth(t),
      payload: {
        type: "tax",
        kind: "vorabpauschale",
        instrumentId: fund.id,
        quantity: "0",
        price: "0",
        currency: "EUR",
        executedAt: "2026-01-27T00:00:00.000Z",
      },
    });
    expect(created.statusCode).toBe(201);
    await app.db
      .update(transactions)
      .set({ vorabBase: "10.00" })
      .where(eq(transactions.id, created.json().id));
    clearValuationCache();

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/tax?year=2026`,
      headers: auth(t),
    });
    const u = res.json().allowanceUsage;
    // Broker base 10.00 x 0.70 = 7.00, not the 12.40 estimate, and not flagged.
    expect(u.vorabpauschaleAccrued).toBe("7.00");
    expect(u.vorabpauschaleEstimated).toBeUndefined();
  });
});
