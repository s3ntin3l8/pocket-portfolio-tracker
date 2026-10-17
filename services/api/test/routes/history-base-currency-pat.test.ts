import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { fxRates, portfolioIntradaySnapshots, portfolioSnapshots } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type * as FxModule from "../../src/services/fx.js";

// Both the daily and (since #1038) the intraday series load rates via getFxRatesForDates.
// The HTTP provider configured below has no rate history, so record the provider argument
// the route passes instead: `null` means cached-only.
const ratesForDates = vi.hoisted(() => ({ providers: [] as unknown[] }));
vi.mock("../../src/services/fx.js", async (importOriginal) => {
  const mod = await importOriginal<typeof FxModule>();
  return {
    ...mod,
    getFxRatesForDates: (...args: Parameters<typeof mod.getFxRatesForDates>) => {
      ratesForDates.providers.push(args.length >= 5 ? args[4] : "default");
      return mod.getFxRatesForDates(...args);
    },
  };
});

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// #1031: converting the per-portfolio history into the current base currency may need an FX
// rate that is not cached yet. A read-scoped PAT must convert with cached rates only (no
// provider fetch/persist, audit A7); a session may fetch. Under NODE_ENV=test there is no FX
// provider at all, so this file configures an HTTP one with a stubbed fetch.

const FX_URL = "https://fx.test/latest";
process.env.FX_BASE_URL = FX_URL;
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url.startsWith(FX_URL)) {
    return new Response(JSON.stringify({ rates: { IDR: 17000 } }), { status: 200 });
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

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.FX_BASE_URL;
  await app.close();
  await closeDb();
});

describe("per-portfolio history FX conversion for a read-scoped PAT (#1031)", () => {
  it("converts with cached rates only for a read PAT, and with the configured provider for a session", async () => {
    const owner = await jwt("history-fx-pat");
    await app.inject({ method: "GET", url: "/me", headers: auth(owner) });
    const minted = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "read", scope: "read" },
    });
    expect(minted.statusCode).toBe(201);
    const readPat = minted.json().token as string;

    const created = await app.inject({
      method: "POST",
      url: "/portfolios",
      headers: auth(owner),
      payload: { name: "EUR→IDR", baseCurrency: "EUR", cashCounted: false },
    });
    const pf = created.json().id as string;
    await app.inject({
      method: "PATCH",
      url: `/portfolios/${pf}`,
      headers: auth(owner),
      payload: { baseCurrency: "IDR" },
    });
    await app.db.insert(portfolioIntradaySnapshots).values({
      portfolioId: pf,
      capturedAt: new Date(Date.now() - 60_000),
      netWorth: "1000",
      marketValue: "1000",
      currency: "EUR",
    });
    const url = `/portfolios/${pf}/history?range=1d`;

    // No cached EUR→IDR rate: the read PAT gets the row excluded, not a provider fetch —
    // its intraday rate load is cached-only (provider `null`).
    ratesForDates.providers.length = 0;
    const ro = await app.inject({ method: "GET", url, headers: auth(readPat) });
    expect(ro.statusCode).toBe(200);
    expect(ro.json()).toEqual([]);
    expect(ro.headers["x-fx-missing-currencies"]).toBe("EUR");
    expect(fxFetches()).toBe(0);
    expect(ratesForDates.providers).toEqual([null]);

    // A session's uses the configured provider (argument left to its default). This HTTP
    // provider has no rate history to back-fill from, so once a rate is cached (as the
    // valuation and the intraday capture job do for today) the session converts with it.
    ratesForDates.providers.length = 0;
    const rwMissing = await app.inject({ method: "GET", url, headers: auth(owner) });
    expect(rwMissing.statusCode).toBe(200);
    expect(ratesForDates.providers).toEqual([undefined]);
    await app.db.insert(fxRates).values({
      base: "EUR",
      quote: "IDR",
      rate: "17000",
      date: toDateKey(new Date(Date.now() - 60_000)),
    });
    const rw = await app.inject({ method: "GET", url, headers: auth(owner) });
    expect(rw.statusCode).toBe(200);
    expect(rw.headers["x-fx-missing-currencies"]).toBeUndefined();
    expect(rw.json().map((p: { netWorth: string }) => Number(p.netWorth))).toEqual([17_000_000]);

    // Daily series: the read PAT's rate load is cached-only (provider `null`); a session's
    // uses the configured provider (argument left to its default).
    await app.db.insert(portfolioSnapshots).values({
      portfolioId: pf,
      date: "2026-02-02",
      netWorth: "1000",
      marketValue: "1000",
      effectiveFlow: "0",
      currency: "EUR",
    });
    const daily = `/portfolios/${pf}/history?range=all`;
    ratesForDates.providers.length = 0;
    expect(
      (await app.inject({ method: "GET", url: daily, headers: auth(readPat) })).statusCode,
    ).toBe(200);
    // The first load is the route's own (snapshot + benchmark currencies); a later one
    // would be benchmarkClosesInCurrency's, which this pin is not about.
    expect(ratesForDates.providers[0]).toBeNull();
    ratesForDates.providers.length = 0;
    expect((await app.inject({ method: "GET", url: daily, headers: auth(owner) })).statusCode).toBe(
      200,
    );
    expect(ratesForDates.providers.length).toBeGreaterThan(0);
    expect(ratesForDates.providers[0]).toBeUndefined();
  });
});
