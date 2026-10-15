import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { instruments, users } from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { rebalancingTrades } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

// GET /networth/rebalancing and GET /portfolios/:id/rebalancing: the "invest new cash"
// what-if. Core computes drift and the buy-only split; the route only wires them to the
// same valuation/allocation the summary routes use.

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

describe("rebalancing what-if with new cash", () => {
  let t: string;
  let other: string;
  let pf: string;

  const post = async (url: string, payload: Record<string, unknown>, tok = t) =>
    app.inject({ method: "POST", url, headers: auth(tok), payload });
  const setTargets = async (url: string, targets: { key: string; targetPct: number }[]) => {
    const res = await app.inject({
      method: "PUT",
      url,
      headers: auth(t),
      payload: { dimension: "asset_class", targets },
    });
    expect(res.statusCode).toBe(200);
  };

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    overrideMarketData(
      new MarketDataService([new FixtureProvider({ RBA: "100", RBB: "100", RBU: "50" })]),
    );

    t = await token("rebalance-user");
    other = await token("rebalance-other");
    for (const tok of [t, other]) {
      await app.inject({ method: "GET", url: "/me", headers: auth(tok) });
    }
    // Display currency EUR so the EUR book needs no FX rate.
    await app.db.update(users).set({ displayCurrency: "EUR" });

    pf = (
      await post("/portfolios", { name: "Book", baseCurrency: "EUR", cashCounted: false })
    ).json().id as string;
    const [a] = await app.db
      .insert(instruments)
      .values({ symbol: "RBA", market: "XETRA", assetClass: "equity", currency: "EUR", name: "A" })
      .returning();
    const [b] = await app.db
      .insert(instruments)
      .values({ symbol: "RBB", market: "XETRA", assetClass: "etf", currency: "EUR", name: "B" })
      .returning();
    for (const inst of [a, b]) {
      const res = await post(`/portfolios/${pf}/transactions`, {
        type: "buy",
        instrumentId: inst.id,
        quantity: "10",
        price: "100",
        currency: "EUR",
        executedAt: "2025-02-01T00:00:00.000Z",
      });
      expect(res.statusCode).toBe(201);
    }
    // 1,000 equity + 1,000 etf: both 50 %. Equity, bond and gold are under their targets.
    const targets = [
      { key: "equity", targetPct: 60 },
      { key: "etf", targetPct: 20 },
      { key: "bond", targetPct: 10 },
      { key: "gold", targetPct: 10 },
    ];
    await setTargets(`/portfolios/${pf}/targets`, targets);
    await setTargets("/networth/targets", targets);
  });

  afterAll(async () => {
    invalidateMarketData();
    await app.close();
    closeDb();
  });

  const urls = () => [
    { name: "portfolio", base: `/portfolios/${pf}/rebalancing` },
    { name: "net worth", base: "/networth/rebalancing" },
  ];

  it.each([0, 1])(
    "splits the new cash across under-target buckets exactly as core does (%#)",
    async (i) => {
      const { base } = urls()[i]!;
      const res = await app.inject({
        method: "GET",
        url: `${base}?dimension=asset_class&newCash=800`,
        headers: auth(t),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.displayCurrency).toBe("EUR");
      expect(body.newCash).toBe("800");
      expect(body.targets).toHaveLength(4);
      // Under target: equity 60, bond 10, gold 10 (sum 80), so 800 splits 600 / 100 / 100.
      const byKey = Object.fromEntries(
        (body.trades as { key: string; deltaValue: string; side: string }[]).map((x) => [x.key, x]),
      );
      expect(byKey.equity).toMatchObject({ deltaValue: "600", side: "buy" });
      expect(byKey.bond).toMatchObject({ deltaValue: "100", side: "buy" });
      expect(byKey.gold).toMatchObject({ deltaValue: "100", side: "buy" });
      expect(byKey.etf).toBeUndefined();
      // Same amounts core produces from the drift the route returned.
      expect(body.trades).toEqual(
        rebalancingTrades(body.drift, "2000", { mode: "newCash", newCash: "800" }),
      );
      // Money stays a decimal string.
      for (const x of body.trades) expect(typeof x.deltaValue).toBe("string");
    },
  );

  it("returns an empty split and no targets for a dimension without targets", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/rebalancing?dimension=currency&newCash=100`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ targets: [], drift: [], trades: [] });
  });

  it.each([undefined, "", "0", "0.00", "-5", "abc", "1e3", "1,5", "5 EUR", "1".repeat(30)])(
    "rejects newCash %j with 400 invalid_new_cash",
    async (newCash) => {
      const qs = new URLSearchParams({ dimension: "asset_class" });
      if (newCash !== undefined) qs.set("newCash", newCash);
      for (const { base } of urls()) {
        const res = await app.inject({ method: "GET", url: `${base}?${qs}`, headers: auth(t) });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: "invalid_new_cash" });
      }
    },
  );

  it("rejects an unknown dimension with 400", async () => {
    for (const { base } of urls()) {
      const res = await app.inject({
        method: "GET",
        url: `${base}?dimension=bogus&newCash=10`,
        headers: auth(t),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_dimension" });
    }
  });

  it("is scoped to the caller: another user's portfolio is a 404 and their net worth is empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/rebalancing?dimension=asset_class&newCash=10`,
      headers: auth(other),
    });
    expect(res.statusCode).toBe(404);
    const nw = await app.inject({
      method: "GET",
      url: "/networth/rebalancing?dimension=asset_class&newCash=10",
      headers: auth(other),
    });
    expect(nw.statusCode).toBe(200);
    expect(nw.json()).toMatchObject({ targets: [], drift: [], trades: [] });
  });

  it("requires authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/networth/rebalancing?dimension=asset_class&newCash=10",
    });
    expect(res.statusCode).toBe(401);
  });

  it("is callable with a read-scoped token (it is a GET)", async () => {
    const minted = await post("/me/tokens", { name: "ro", scope: "read" });
    const pat = minted.json().token as string;
    const res = await app.inject({
      method: "GET",
      url: "/networth/rebalancing?dimension=asset_class&newCash=10",
      headers: auth(pat),
    });
    expect(res.statusCode).toBe(200);
  });

  it("reports a currency without an FX rate (top level + header) instead of converting 1:1", async () => {
    const [u] = await app.db
      .insert(instruments)
      .values({ symbol: "RBU", market: "NASDAQ", assetClass: "equity", currency: "USD", name: "U" })
      .returning();
    const fx = (
      await post("/portfolios", { name: "Mixed book", baseCurrency: "EUR", cashCounted: false })
    ).json().id as string;
    await post(`/portfolios/${fx}/transactions`, {
      type: "buy",
      instrumentId: u.id,
      quantity: "10",
      price: "40",
      currency: "USD",
      executedAt: "2025-02-01T00:00:00.000Z",
    });
    for (const url of [
      "/networth/rebalancing?dimension=asset_class&newCash=100",
      `/portfolios/${fx}/rebalancing?dimension=asset_class&newCash=100`,
    ]) {
      const res = await app.inject({ method: "GET", url, headers: auth(t) });
      expect(res.statusCode).toBe(200);
      expect(res.json().fxMissingCurrencies).toEqual(["USD"]);
      expect(res.headers["x-fx-missing-currencies"]).toBe("USD");
    }
  });
});
