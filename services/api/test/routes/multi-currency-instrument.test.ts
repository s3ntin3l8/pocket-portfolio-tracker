import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { fxRates, instruments, portfolioSnapshots, prices, transactions } from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData } from "../../src/services/market-data.js";

// Audit B13: one instrument booked in a different currency in each of two portfolios is
// valid per depot (each depot's cost basis has one currency), but the aggregate routes
// used to pool every portfolio's transactions into a single computeHoldings call, which
// throws on mixed currencies — /insights and /networth/income answered 500.

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

describe("one instrument in different currencies across portfolios (audit B13)", () => {
  let t: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    overrideMarketData(new MarketDataService([new FixtureProvider({ MULTI: "120" })]));

    t = await token("multi-ccy-instrument-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const today = toDateKey(new Date());
    await app.db.insert(fxRates).values([
      { base: "EUR", quote: "IDR", rate: "17000", date: today },
      { base: "EUR", quote: "IDR", rate: "17000", date: "2026-01-01" },
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
    const eurPf = await mk("EUR depot", "EUR");
    const idrPf = await mk("IDR depot", "IDR");

    const [inst] = await app.db
      .insert(instruments)
      .values({
        symbol: "MULTI",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "Multi-currency booking",
      })
      .returning();

    await app.db.insert(transactions).values([
      {
        portfolioId: eurPf,
        instrumentId: inst.id,
        type: "buy",
        quantity: "10",
        price: "100",
        currency: "EUR",
        executedAt: new Date("2026-01-05T10:00:00.000Z"),
      },
      // Same instrument, booked in IDR in the other depot.
      {
        portfolioId: idrPf,
        instrumentId: inst.id,
        type: "buy",
        quantity: "5",
        price: "1700000",
        currency: "IDR",
        executedAt: new Date("2026-01-06T10:00:00.000Z"),
      },
      // A dividend so the income route's per-date holdings lookup actually runs.
      {
        portfolioId: eurPf,
        instrumentId: inst.id,
        type: "dividend",
        quantity: "0",
        price: "20",
        currency: "EUR",
        executedAt: new Date("2026-03-15T10:00:00.000Z"),
      },
    ]);

    const days = ["2026-01-31", "2026-02-28", "2026-03-31"];
    await app.db
      .insert(prices)
      .values(days.map((date) => ({ instrumentId: inst.id, date, close: "110", currency: "EUR" })));
    await app.db.insert(portfolioSnapshots).values(
      [eurPf, idrPf].flatMap((portfolioId) =>
        days.map((date) => ({
          portfolioId,
          date,
          netWorth: "1000",
          marketValue: "1000",
          effectiveFlow: "0",
          currency: portfolioId === eurPf ? "EUR" : "IDR",
        })),
      ),
    );
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("/insights answers 200 instead of 500", async () => {
    const res = await app.inject({ method: "GET", url: "/insights?range=all", headers: auth(t) });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("/networth/income answers 200 instead of 500", async () => {
    const res = await app.inject({ method: "GET", url: "/networth/income", headers: auth(t) });
    expect(res.statusCode, res.body).toBe(200);
  });
});
