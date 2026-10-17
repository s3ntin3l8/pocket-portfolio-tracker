import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { portfolioIntradaySnapshots } from "@portfolio/db";
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
  it("converts with cached rates only for a read PAT, and fetches for a session", async () => {
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

    // No cached EUR→IDR rate: the read PAT gets the row excluded, not a provider fetch.
    const ro = await app.inject({ method: "GET", url, headers: auth(readPat) });
    expect(ro.statusCode).toBe(200);
    expect(ro.json()).toEqual([]);
    expect(ro.headers["x-fx-missing-currencies"]).toBe("EUR");
    expect(fxFetches()).toBe(0);

    // A session may fetch (and cache) the rate.
    const rw = await app.inject({ method: "GET", url, headers: auth(owner) });
    expect(rw.statusCode).toBe(200);
    expect(fxFetches()).toBe(1);
    expect(rw.json().map((p: { netWorth: string }) => Number(p.netWorth))).toEqual([17_000_000]);
  });
});
