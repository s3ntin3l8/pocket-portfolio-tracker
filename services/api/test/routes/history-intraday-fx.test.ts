import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { fxRates, portfolioIntradaySnapshots, users } from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

// #1038: the 1D/7D series converts each intraday point at the rate of its own capture date
// (UTC), like the daily series converts each snapshot at its date's rate — not every point
// at today's rate. A 7-day window can span an FX move; it belongs in the points it happened
// between, not in a constant multiplier over the whole window.

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

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey });
  overrideMarketData(new MarketDataService([new FixtureProvider({})]));
});

afterAll(async () => {
  invalidateMarketData();
  await app.close();
  await closeDb();
});

describe("intraday (1D/7D) history converts each point at its capture date's FX rate (#1038)", () => {
  let t: string;
  let pf: string;
  // Two capture times on two different UTC dates, three days apart.
  const recent = new Date(Date.now() - 60_000);
  const earlier = new Date(recent.getTime() - 3 * 86_400_000);
  const earlierDate = toDateKey(earlier);
  const recentDate = toDateKey(recent);

  beforeAll(async () => {
    t = await token("history-intraday-fx");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    await app.db
      .update(users)
      .set({ displayCurrency: "IDR" })
      .where(eq(users.authSub, "history-intraday-fx"));

    const created = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(t),
      payload: { name: "EUR→IDR intraday", baseCurrency: "EUR", cashCounted: false },
    });
    expect(created.statusCode).toBe(201);
    pf = created.json().id as string;
    // Switch the base so the per-portfolio series must convert the EUR rows too.
    const patched = await app.inject({
      method: "PATCH",
      url: `/portfolios/${pf}`,
      headers: auth(t),
      payload: { baseCurrency: "IDR" },
    });
    expect(patched.statusCode).toBe(200);

    // EUR→IDR moves from 17,000 to 18,000 between the two capture dates.
    await app.db.insert(fxRates).values([
      { base: "EUR", quote: "IDR", rate: "17000", date: earlierDate },
      { base: "EUR", quote: "IDR", rate: "18000", date: recentDate },
    ]);
    await app.db.insert(portfolioIntradaySnapshots).values([
      {
        portfolioId: pf,
        capturedAt: earlier,
        netWorth: "1000",
        marketValue: "900",
        currency: "EUR",
      },
      {
        portfolioId: pf,
        capturedAt: recent,
        netWorth: "1000",
        marketValue: "900",
        currency: "EUR",
      },
    ]);
  });

  it("per-portfolio: /portfolios/:id/history?range=7d", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/history?range=7d`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-fx-missing-currencies"]).toBeUndefined();
    const body = res.json() as { at: string; netWorth: string; marketValue: string }[];
    expect(body.map((p) => p.at)).toEqual([earlier.toISOString(), recent.toISOString()]);
    expect(body.map((p) => Number(p.netWorth))).toEqual([17_000_000, 18_000_000]);
    expect(body.map((p) => Number(p.marketValue))).toEqual([15_300_000, 16_200_000]);
  });

  it("aggregate: /networth/history?range=7d", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/networth/history?range=7d",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-fx-missing-currencies"]).toBeUndefined();
    const body = res.json() as { at: string; netWorth: string; marketValue: string }[];
    expect(body.map((p) => p.at)).toEqual([earlier.toISOString(), recent.toISOString()]);
    expect(body.map((p) => Number(p.netWorth))).toEqual([17_000_000, 18_000_000]);
    expect(body.map((p) => Number(p.marketValue))).toEqual([15_300_000, 16_200_000]);
  });

  it("still excludes (never 1:1) and reports a currency with no rate at all", async () => {
    // SGD has no rate to IDR anywhere in this file's database.
    await app.db.insert(portfolioIntradaySnapshots).values({
      portfolioId: pf,
      capturedAt: new Date(recent.getTime() + 1_000),
      netWorth: "500",
      marketValue: "500",
      currency: "SGD",
    });
    for (const url of [`/portfolios/${pf}/history?range=1d`, "/networth/history?range=1d"]) {
      // Different range from the tests above, so neither cached entry is replayed.
      const res = await app.inject({ method: "GET", url, headers: auth(t) });
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-fx-missing-currencies"]).toBe("SGD");
      const body = res.json() as { at: string; netWorth: string }[];
      expect(body.map((p) => p.at)).toEqual([recent.toISOString()]);
      expect(body.map((p) => Number(p.netWorth))).toEqual([18_000_000]);
    }
  });
});
