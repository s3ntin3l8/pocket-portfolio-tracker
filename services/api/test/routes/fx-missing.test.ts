import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { fxRates, instruments, portfolios } from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { loadBoundaryFlowsForUser } from "../../src/routes/transactions/insights/yearly-returns.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";
import { netWorthResponseSchema, portfolioSummaryResponseSchema } from "@portfolio/schema";

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

  it("aggregate net worth excludes the unrated holding instead of counting it 1:1", async () => {
    const res = await app.inject({ method: "GET", url: "/networth", headers: auth(t) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    netWorthResponseSchema.parse(body);
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

describe("missing QUOTE currency keeps contributions and value on one boundary (audit B2)", () => {
  let t: string;
  let pf: string;

  beforeAll(async () => {
    t = await token("fx-quote-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    pf = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        // Outside boundary: contribution = net invested capital, value = securities only.
        payload: { name: "Cross ccy", baseCurrency: "EUR", cashCounted: false },
      })
    ).json().id as string;
    const [eurStock] = await app.db
      .insert(instruments)
      .values({
        symbol: "XQEUR",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "E",
      })
      .returning();
    // Bought in EUR (trade currency converts), but QUOTED in USD — and USD has no rate.
    const [usdQuoted] = await app.db
      .insert(instruments)
      .values({
        symbol: "XQUSD",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "U",
      })
      .returning();
    for (const [instrumentId, price] of [
      [eurStock.id, "100"],
      [usdQuoted.id, "100"],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url: `/portfolios/${pf}/transactions`,
        headers: auth(t),
        payload: {
          type: "buy",
          instrumentId,
          quantity: "10",
          price,
          currency: "EUR",
          executedAt: "2025-01-02T00:00:00.000Z",
        },
      });
      expect(res.statusCode).toBe(201);
    }
    overrideMarketData(
      new MarketDataService([new FixtureProvider({ XQEUR: "110", XQUSD: "120" })]),
    );
  });

  it("drops the unvalued instrument's buy from the contribution, not just its value", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/contributions`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fxMissingCurrencies).toEqual(["USD"]);
    // Only the EUR stock's 1,000 — the USD-quoted buy is out on both sides. Before the
    // fix it stayed in (2,000) against a value of 1,100: a phantom −45%.
    expect(Number(body.netContributed)).toBe(1000);
    expect(body.simpleGainPct).toBeCloseTo(0.1, 6);
  });

  it("leaves no dangling buy in the XIRR flows (return is positive, not a near-total loss)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/performance`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Number(body.netWorth)).toBe(1100);
    expect(body.xirr).toBeGreaterThan(0);
  });

  it("leaves no dangling buy in the per-year XIRR flows either (#1020)", async () => {
    const [row] = await app.db
      .select({ userId: portfolios.userId })
      .from(portfolios)
      .where(eq(portfolios.id, pf));
    const flows = await loadBoundaryFlowsForUser(app, row!.userId, [pf], "EUR", "outside");
    // Only the EUR stock's buy; before the fix the USD-quoted buy (no value against it on
    // the year-end NAV side) was a second −1,000.
    expect(flows.map((f) => Number(f.amount))).toEqual([-1000]);
  });
});

describe("cash in a foreign currency is converted into the display currency", () => {
  let t: string;
  let pf: string;

  beforeAll(async () => {
    t = await token("fx-cash-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    pf = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        // Cash inside the boundary, so the balances count towards net worth.
        payload: { name: "Cash book", baseCurrency: "IDR", cashCounted: true },
      })
    ).json().id as string;
    const deposit = async (price: string, currency: string) => {
      const res = await app.inject({
        method: "POST",
        url: `/portfolios/${pf}/transactions`,
        headers: auth(t),
        payload: {
          type: "deposit",
          quantity: "1",
          price,
          currency,
          executedAt: "2025-02-01T00:00:00.000Z",
        },
      });
      expect(res.statusCode).toBe(201);
    };
    // EUR→IDR is rated (17,000, seeded by the first suite); USD has no rate.
    await deposit("8214.80", "EUR");
    await deposit("100", "USD");
  });

  it("/networth reports cashDisplay in IDR, leaving the unrated currency out", async () => {
    const res = await app.inject({ method: "GET", url: "/networth", headers: auth(t) });
    expect(res.statusCode).toBe(200);
    const body = netWorthResponseSchema.parse(res.json());
    expect(body.displayCurrency).toBe("IDR");
    expect(body.cash).toEqual({ EUR: "8214.8", USD: "100" });
    // 8,214.80 × 17,000 — never the raw 8,214.80, and no USD at 1:1.
    expect(body.cashDisplay).toEqual({ EUR: "139651600" });
    expect(body.fxMissingCurrencies).toEqual(["USD"]);
    // What the Holdings table sums for cash is exactly what net worth counts.
    expect(Number(body.netWorth)).toBe(139_651_600);
  });

  it("/portfolios/:id/summary carries the same cashDisplay", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/summary`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = portfolioSummaryResponseSchema.parse(res.json());
    expect(body.displayCurrency).toBe("IDR");
    expect(body.cashDisplay).toEqual({ EUR: "139651600" });
    expect(Number(body.netWorth)).toBe(139_651_600);
  });
});

// One app for both suites (the first suite builds it); closed once at the very end.
afterAll(async () => {
  invalidateMarketData();
  await app.close();
  await closeDb();
});
