import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { transactions, users } from "@portfolio/db";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// Audit G2: /networth and /portfolios/:id/summary expose one GainSummary whose
// netContributed is on the same boundary as the value.

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
const DAY = 86_400_000;

describe("GainSummary on the summary + networth responses (audit G2)", () => {
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
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("returns value, costOfOpen, netContributed, unrealized, realized, income", async () => {
    const t = await token("gain-summary-user");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    await app.db
      .update(users)
      .set({ displayCurrency: "EUR" })
      .where(eq(users.authSub, "gain-summary-user"));
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Savings", baseCurrency: "EUR", cashCounted: true },
      })
    ).json().id as string;
    await app.db.insert(transactions).values([
      {
        portfolioId,
        type: "deposit",
        quantity: "0",
        price: "1000",
        fees: "0",
        currency: "EUR",
        executedAt: new Date(Date.now() - 30 * DAY),
      },
      {
        portfolioId,
        type: "withdrawal",
        quantity: "0",
        price: "200",
        fees: "0",
        currency: "EUR",
        executedAt: new Date(Date.now() - 10 * DAY),
      },
    ]);

    const summary = await app.inject({
      method: "GET",
      url: `/portfolios/${portfolioId}/summary`,
      headers: auth(t),
    });
    expect(summary.statusCode).toBe(200);
    const g = summary.json().gain;
    expect(g).toMatchObject({
      displayCurrency: "EUR",
      boundary: "inside",
      value: "800",
      costOfOpen: "0",
      netContributed: "800",
      unrealized: "0",
      realized: "0",
      income: "0",
    });

    const nw = await app.inject({ method: "GET", url: "/networth", headers: auth(t) });
    expect(nw.statusCode).toBe(200);
    // Same figures at aggregate scope, and the value is the response's own net worth.
    expect(nw.json().gain).toMatchObject({ boundary: "inside", netContributed: "800" });
    expect(nw.json().gain.value).toBe(nw.json().netWorth);
  });
});
