import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq, sql } from "drizzle-orm";
import {
  fxRates,
  instruments,
  portfolioSnapshots,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import type * as FxModule from "../../src/services/fx.js";

// Audit A7: a read-scoped PAT must never make a GET fetch FX rates from the provider or
// persist them — on every route, not only the ones that pass a provider explicitly. The
// cached-only provider is the request-scoped default for such a request
// (lib/fx-cached-only.ts), and cached derivations keep its result apart from a session's.
//
// Two probes, because the HTTP provider configured below only serves spot rates:
// - `getFxRates` (spot) really fetches through the stubbed `fetch`: count those calls and
//   the `fx_rates` rows they would persist.
// - `getFxRatesForDates` (historical) would back-fill only from a provider with a rate
//   history, so record the provider each call resolves to instead — the explicit argument,
//   else the loader's request-aware default.
const resolved = vi.hoisted(() => ({ providers: [] as unknown[] }));
vi.mock("../../src/services/fx.js", async (importOriginal) => {
  const mod = await importOriginal<typeof FxModule>();
  // Before the request-scoped default existed, the loaders fell back to getFxProvider().
  const fallback = () => {
    const d = (mod as { defaultFxProvider?: () => unknown }).defaultFxProvider;
    return d ? d() : mod.getFxProvider();
  };
  return {
    ...mod,
    getFxRatesForDates: (...args: Parameters<typeof mod.getFxRatesForDates>) => {
      resolved.providers.push(args[4] !== undefined ? args[4] : fallback());
      return mod.getFxRatesForDates(...args);
    },
  };
});

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";
import { clearDerivationCache } from "../../src/lib/derivation-cache.js";
import { clearValuationCache } from "../../src/services/valuation.js";

/** Each route starts with no cached rate and no cached derivation, so it must load FX
 *  itself — otherwise an earlier route's fetch (or cached result) would hide its own. */
async function resetFx() {
  await app.db.delete(fxRates);
  clearDerivationCache();
  clearValuationCache();
}

const FX_URL = "https://fx.test/latest";
process.env.FX_BASE_URL = FX_URL;
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url.startsWith(FX_URL)) {
    const to = new URL(url).searchParams.get("symbols") ?? "IDR";
    return new Response(JSON.stringify({ rates: { [to]: to === "IDR" ? 17000 : 0.9 } }), {
      status: 200,
    });
  }
  return new Response("not found", { status: 404 });
});
vi.stubGlobal("fetch", fetchMock);

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function jwt(sub: string) {
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
const fxFetches = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(FX_URL)).length;
async function fxRowCount() {
  const [row] = await app.db.select({ n: sql<number>`count(*)::int` }).from(fxRates);
  return Number(row!.n);
}

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
  vi.unstubAllGlobals();
  delete process.env.FX_BASE_URL;
  await app.close();
  await closeDb();
});

describe("a read-scoped PAT loads FX from cached rates only on every read route (A7)", () => {
  const sub = "read-pat-fx-sweep";
  let owner: string;
  let readPat: string;
  const pfIds: string[] = [];

  beforeAll(async () => {
    owner = await jwt(sub);
    await app.inject({ method: "GET", url: "/me", headers: auth(owner) });
    const minted = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "read", scope: "read" },
    });
    expect(minted.statusCode).toBe(201);
    readPat = minted.json().token as string;
    await app.db.update(users).set({ displayCurrency: "IDR" }).where(eq(users.authSub, sub));

    // EUR portfolios (one per boundary) shown in IDR, each also holding a USD-priced
    // instrument, with no rate cached: the aggregate (IDR) and the per-portfolio (EUR)
    // views both need rates the provider could serve.
    const [usd] = await app.db
      .insert(instruments)
      .values({
        symbol: "FXSWEEPUS",
        market: "NASDAQ",
        assetClass: "equity",
        currency: "USD",
        name: "FX sweep Inc",
      })
      .returning({ id: instruments.id });
    await app.db
      .insert(prices)
      .values({ instrumentId: usd!.id, date: "2026-02-03", close: "55", currency: "USD" });
    const [inst] = await app.db
      .insert(instruments)
      .values({
        symbol: "FXSWEEP",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "FX sweep AG",
      })
      .returning({ id: instruments.id });
    await app.db
      .insert(prices)
      .values({ instrumentId: inst!.id, date: "2026-02-03", close: "110", currency: "EUR" });
    // An account holder, so /networth/tax values the portfolios too.
    const holder = await app.inject({
      method: "POST",
      url: "/account-holders",
      headers: auth(owner),
      payload: { name: "Holder", type: "self" },
    });
    expect(holder.statusCode).toBe(201);
    const accountHolderId = holder.json().id as string;
    for (const cashCounted of [false, true]) {
      const created = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(owner),
        payload: {
          name: `EUR ${cashCounted}`,
          baseCurrency: "EUR",
          cashCounted,
          taxAllowanceAnnual: "1000",
          accountHolderId,
        },
      });
      expect(created.statusCode).toBe(201);
      const pf = created.json().id as string;
      pfIds.push(pf);
      await app.db.insert(transactions).values([
        {
          portfolioId: pf,
          type: "deposit",
          quantity: "0",
          price: "2000",
          currency: "EUR",
          executedAt: new Date("2026-02-01"),
        },
        {
          portfolioId: pf,
          instrumentId: inst!.id,
          type: "buy",
          quantity: "10",
          price: "100",
          currency: "EUR",
          executedAt: new Date("2026-02-02"),
        },
        {
          portfolioId: pf,
          instrumentId: usd!.id,
          type: "buy",
          quantity: "5",
          price: "50",
          currency: "USD",
          executedAt: new Date("2026-02-02"),
        },
      ]);
      await app.db.insert(portfolioSnapshots).values(
        ["2026-02-02", "2026-02-03"].map((date) => ({
          portfolioId: pf,
          date,
          netWorth: "2000",
          marketValue: "1000",
          effectiveFlow: "0",
          currency: "EUR",
        })),
      );
    }
  });

  const routes = [
    "/networth",
    "/networth/history?range=all",
    "/networth/contributions",
    "/networth/trades",
    "/networth/tax",
    "/networth/income",
    "/networth/sparplan",
    "/networth/gold",
    "/networth/targets?dimension=asset_class",
    "/networth/rebalancing?dimension=asset_class&newCash=100",
    "/networth/transactions",
    "/networth/anomalies",
    "/insights?range=all",
    "/portfolios/values",
    "/portfolios/:pf/summary",
    "/portfolios/:pf/holdings",
    "/portfolios/:pf/history?range=all",
    "/portfolios/:pf/performance",
    "/portfolios/:pf/contributions",
    "/portfolios/:pf/trades",
    "/portfolios/:pf/tax",
    "/portfolios/:pf/income",
    "/portfolios/:pf/sparplan",
    "/portfolios/:pf/gold",
    "/portfolios/:pf/targets?dimension=asset_class",
    "/portfolios/:pf/rebalancing?dimension=asset_class&newCash=100",
    "/portfolios/:pf/transactions",
    "/portfolios/:pf/anomalies",
    "/fx-rate?from=EUR&to=IDR&date=2026-02-03",
  ];

  it.each(routes)("GET %s: no provider fetch, no persisted rate", async (path) => {
    await resetFx();
    const rowsBefore = await fxRowCount();
    const fetchesBefore = fxFetches();
    resolved.providers.length = 0;
    for (const pf of pfIds) {
      const url = path.replace(":pf", pf);
      const res = await app.inject({ method: "GET", url, headers: auth(readPat) });
      expect(res.statusCode, `${url}: ${res.body.slice(0, 200)}`).toBe(200);
      if (!path.includes(":pf")) break;
    }
    expect(fxFetches() - fetchesBefore).toBe(0);
    expect(await fxRowCount()).toBe(rowsBefore);
    expect(resolved.providers.filter((p) => p !== null)).toEqual([]);
  });

  // No cache flush between the two requests: the session must not be served the read PAT's
  // cached-only valuation (derivationCacheKey keys it apart), so it loads — and fetches —
  // the rate itself. /summary's only FX load is the valuation's.
  it("a session after a read PAT gets its own valuation, not the cached-only one", async () => {
    await resetFx();
    const url = `/portfolios/${pfIds[0]}/summary`;
    const ro = await app.inject({ method: "GET", url, headers: auth(readPat) });
    expect(ro.statusCode).toBe(200);
    const fetchesBefore = fxFetches();
    const rw = await app.inject({ method: "GET", url, headers: auth(owner) });
    expect(rw.statusCode).toBe(200);
    expect(fxFetches()).toBeGreaterThan(fetchesBefore);
    expect(ro.headers["x-fx-missing-currencies"]).toBe("USD");
    expect(rw.headers["x-fx-missing-currencies"]).toBeUndefined();
  });

  // The stub is live: a session on the same data does fetch and cache the rate.
  it("a session on the same data fetches and caches the rate (the probe is live)", async () => {
    await resetFx();
    const rowsBefore = await fxRowCount();
    const res = await app.inject({ method: "GET", url: "/networth", headers: auth(owner) });
    expect(res.statusCode).toBe(200);
    expect(fxFetches()).toBeGreaterThan(0);
    expect(await fxRowCount()).toBeGreaterThan(rowsBefore);
  });
});
