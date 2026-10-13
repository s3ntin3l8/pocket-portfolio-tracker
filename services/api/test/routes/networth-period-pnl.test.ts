import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { portfolioSnapshots, transactions, users } from "@portfolio/db";
import { eq } from "drizzle-orm";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

// Audit B10: /networth's period P&L was `current − startNav`, so money deposited inside
// the period was reported as profit.

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

describe("/networth period P&L nets out boundary flows (audit B10)", () => {
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

  it("a deposit inside the period is not period profit", async () => {
    const t = await token("networth-period-pnl-user");
    // Pin the display currency to the portfolio's so no FX is involved.
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    await app.db
      .update(users)
      .set({ displayCurrency: "EUR" })
      .where(eq(users.authSub, "networth-period-pnl-user"));
    const portfolioId = (
      await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(t),
        payload: { name: "Savings", baseCurrency: "EUR", cashCounted: true },
      })
    ).json().id as string;

    const now = Date.now();
    const anchorDay = toDateKey(new Date(now - 300 * DAY));
    await app.db.insert(transactions).values([
      // Before the period: 1,000 deposited (embedded in the opening snapshot).
      {
        portfolioId,
        type: "deposit",
        quantity: "0",
        price: "1000",
        fees: "0",
        currency: "EUR",
        executedAt: new Date(now - 400 * DAY),
      },
      // Inside the period: another 500 deposited. No market movement at all.
      {
        portfolioId,
        type: "deposit",
        quantity: "0",
        price: "500",
        fees: "0",
        currency: "EUR",
        executedAt: new Date(now - 100 * DAY),
      },
    ]);
    await app.db
      .insert(portfolioSnapshots)
      .values({ portfolioId, date: anchorDay, netWorth: "1000", currency: "EUR" });

    const res = await app.inject({
      method: "GET",
      url: "/networth?period=1y",
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      netWorth: string;
      periodPnL: string | null;
      periodPnLPct: string | null;
    };
    expect(body.netWorth).toBe("1500");
    // Pre-fix: "500" (the deposit booked as profit).
    expect(body.periodPnL).toBe("0");
    expect(Number(body.periodPnLPct)).toBe(0);
  });
});
