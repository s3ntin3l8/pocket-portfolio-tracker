import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { fxRates, instruments } from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

// Audit B2 contract: a currency with no FX rate is never converted 1:1 and never fails the
// request — the affected rows/holdings are excluded from converted totals and the response
// reports them as `fxMissingCurrencies` (+ the `x-fx-missing-currencies` header).

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

describe("missing FX rate → 200 + fxMissingCurrencies, never 1:1 (audit B2)", () => {
  let t: string;
  let eurPf: string;
  let usdPf: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    overrideMarketData(new MarketDataService([new FixtureProvider({ FXEUR: "110", FXUSD: "50" })]));

    t = await token("fx-missing-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    // Display IDR; EUR→IDR is rated, USD has no rate at all (and no provider under test).
    await app.db.insert(fxRates).values([
      { base: "EUR", quote: "IDR", rate: "17000", date: toDateKey(new Date()) },
      { base: "EUR", quote: "IDR", rate: "17000", date: "2025-01-01" },
    ]);

    const mk = async (name: string, baseCurrency: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/portfolios",
          headers: auth(t),
          payload: { name, baseCurrency, cashCounted: false },
        })
      ).json().id as string;
    eurPf = await mk("EUR book", "EUR");
    usdPf = await mk("USD book", "USD");

    const [eurStock] = await app.db
      .insert(instruments)
      .values({
        symbol: "FXEUR",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "E",
      })
      .returning();
    const [usdStock] = await app.db
      .insert(instruments)
      .values({
        symbol: "FXUSD",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "U",
      })
      .returning();

    const post = async (pf: string, payload: Record<string, unknown>) => {
      const res = await app.inject({
        method: "POST",
        url: `/portfolios/${pf}/transactions`,
        headers: auth(t),
        payload,
      });
      expect(res.statusCode).toBe(201);
    };
    await post(eurPf, {
      type: "buy",
      instrumentId: eurStock.id,
      quantity: "10",
      price: "100",
      currency: "EUR",
      executedAt: "2025-02-01T00:00:00.000Z",
    });
    await post(usdPf, {
      type: "buy",
      instrumentId: usdStock.id,
      quantity: "10",
      price: "40",
      currency: "USD",
      executedAt: "2025-02-01T00:00:00.000Z",
    });
    await post(usdPf, {
      type: "sell",
      instrumentId: usdStock.id,
      quantity: "2",
      price: "45",
      currency: "USD",
      executedAt: "2025-03-01T00:00:00.000Z",
    });
    await post(usdPf, {
      type: "dividend",
      instrumentId: usdStock.id,
      quantity: "0",
      price: "7",
      currency: "USD",
      executedAt: "2025-04-01T00:00:00.000Z",
    });
  });

  afterAll(async () => {
    invalidateMarketData();
    await app.close();
    await closeDb();
  });

  it("aggregate net worth excludes the unrated holding instead of counting it 1:1", async () => {
    const res = await app.inject({ method: "GET", url: "/networth", headers: auth(t) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fxMissingCurrencies).toEqual(["USD"]);
    expect(res.headers["x-fx-missing-currencies"]).toBe("USD");
    // Only the EUR holding: 10 × 110 × 17,000 — not + 8 × 50 (USD at 1:1).
    expect(Number(body.netWorth)).toBe(18_700_000);
  });

  it("trades, income, contributions, sparplan and tax answer 200 and report USD", async () => {
    for (const url of [
      "/networth/trades",
      "/networth/income",
      "/networth/contributions",
      "/networth/sparplan",
      "/networth/tax?year=2025",
      "/networth/history?range=all",
      "/insights",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(t) });
      expect(res.statusCode, url).toBe(200);
      const header = res.headers["x-fx-missing-currencies"];
      if (header !== undefined) expect(header, url).toBe("USD");
    }
    const trades = await app.inject({ method: "GET", url: "/networth/trades", headers: auth(t) });
    expect(trades.json().fxMissingCurrencies).toEqual(["USD"]);
    // The USD round trip is excluded — no USD realized P&L counted 1:1 (2 × 5 = 10).
    expect(trades.json().totalRealized).toBe("0");

    const income = await app.inject({ method: "GET", url: "/networth/income", headers: auth(t) });
    expect(income.json().fxMissingCurrencies).toEqual(["USD"]);
  });

  it("a portfolio summary in its own currency needs no FX and reports nothing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${usdPf}/summary`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fxMissingCurrencies ?? []).toEqual([]);
    expect(res.headers["x-fx-missing-currencies"]).toBeUndefined();
  });
});
