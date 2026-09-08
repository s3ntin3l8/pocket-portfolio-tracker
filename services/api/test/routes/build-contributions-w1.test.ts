import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

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

async function createPortfolio(t: string, opts: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name: "W1 Pf", baseCurrency: "EUR", ...opts },
  });
  return res.json().id as string;
}

async function postTx(
  t: string,
  portfolioId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: `/portfolios/${portfolioId}/transactions`,
    headers: auth(t),
    payload,
  });
  expect(res.statusCode).toBe(201);
}

describe("buildContributions — outside-boundary wiring (S8 / W1)", () => {
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

  it("per-portfolio /portfolios/:id/contributions returns valid response when cashCounted=false", async () => {
    const t = await token("w1-pf-outside");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    // cashCounted=false → "outside" boundary in enrichContributions.
    const pf = await createPortfolio(t, { cashCounted: false });
    // A buy so contributionStats has activity to surface (otherwise the route returns
    // empty / status: ok but with zero series).
    await postTx(t, pf, {
      type: "buy",
      quantity: "1",
      price: "100",
      currency: "EUR",
      executedAt: "2026-01-15T00:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/contributions`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayCurrency).toBe("EUR");
    expect(body).not.toHaveProperty("requiresBudgetPlan");
  });

  it("per-portfolio /portfolios/:id/contributions returns valid response when cashCounted=true (inside)", async () => {
    const t = await token("w1-pf-inside");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    const pf = await createPortfolio(t, { cashCounted: true });
    await postTx(t, pf, {
      type: "deposit",
      price: "100",
      currency: "EUR",
      executedAt: "2026-01-15T00:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/contributions`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayCurrency).toBe("EUR");
    expect(body).not.toHaveProperty("requiresBudgetPlan");
  });

  it("networth /networth/contributions returns valid response with mixed boundaries", async () => {
    const t = await token("w1-nw-outside");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    // Mixed boundary set: one outside + one inside.
    await createPortfolio(t, { cashCounted: false, name: "NW-OUT" });
    await createPortfolio(t, { cashCounted: true, name: "NW-IN" });

    const res = await app.inject({
      method: "GET",
      url: "/networth/contributions",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("displayCurrency");
    expect(body).not.toHaveProperty("requiresBudgetPlan");
  });

  it("networth /networth/contributions returns valid response when ALL portfolios are inside-boundary", async () => {
    const t = await token("w1-nw-inside");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    await createPortfolio(t, { cashCounted: true, name: "NW-IN-A" });
    await createPortfolio(t, { cashCounted: true, name: "NW-IN-B" });

    const res = await app.inject({
      method: "GET",
      url: "/networth/contributions",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("displayCurrency");
    expect(body).not.toHaveProperty("requiresBudgetPlan");
  });
});
