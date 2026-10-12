/**
 * POST /instruments is open for find-or-create, but the upgrade path on an EXISTING shared
 * row is tiered: same-family refinements for everyone, cross-family assetClass changes and
 * market/currency re-pins for admins only (audit A1).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { instruments } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
const ADMIN_GROUP = "portfolio-admins";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string, groups?: string[]) {
  return new SignJWT({ email: `${sub}@example.com`, ...(groups ? { groups } : {}) })
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
  process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
  process.env.RATE_LIMIT_MAX = "50000";
  app = await buildApp({ authKey: kp.publicKey });
}, 30_000);

afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
  delete process.env.AUTHENTIK_ADMIN_GROUP;
  delete process.env.RATE_LIMIT_MAX;
});

async function seed(symbol: string, assetClass: string, market = "XETRA", currency = "EUR") {
  const [row] = await app.db
    .insert(instruments)
    .values({
      symbol,
      market,
      assetClass: assetClass as "equity",
      unit: "shares",
      currency,
      name: symbol,
    })
    .returning();
  return row;
}

const post = (t: string, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/instruments", headers: auth(t), payload });

async function reload(id: string) {
  const [row] = await app.db.select().from(instruments).where(eq(instruments.id, id));
  return row;
}

describe("POST /instruments upgrade tiers", () => {
  it("non-admin cannot turn an equity row into a bond", async () => {
    const row = await seed("UPG-EQ", "equity");
    const res = await post(await token("upg-user-1"), {
      symbol: "UPG-EQ",
      market: "XETRA",
      assetClass: "bond",
      unit: "units",
      currency: "EUR",
      name: "UPG-EQ",
    });
    expect(res.statusCode).toBe(201);
    expect((await reload(row.id)).assetClass).toBe("equity");
  });

  it("non-admin can still refine mutual_fund to etf", async () => {
    const row = await seed("UPG-MF", "mutual_fund");
    const res = await post(await token("upg-user-2"), {
      symbol: "UPG-MF",
      market: "XETRA",
      assetClass: "etf",
      unit: "shares",
      currency: "EUR",
      name: "UPG-MF",
    });
    expect(res.statusCode).toBe(201);
    expect((await reload(row.id)).assetClass).toBe("etf");
  });

  it("non-admin still heals a row stuck on the Xetra/EUR default (guarded re-pin)", async () => {
    const isin = "US0378331005";
    const row = await seed("UPG-PIN", "equity");
    await app.db.update(instruments).set({ isin }).where(eq(instruments.id, row.id));
    const res = await post(await token("upg-user-3"), {
      symbol: "UPG-PIN",
      market: "US",
      assetClass: "equity",
      unit: "shares",
      currency: "USD",
      name: "UPG-PIN",
      isin,
    });
    expect(res.statusCode).toBe(201);
    const after = await reload(row.id);
    expect(after.market).toBe("US");
    expect(after.currency).toBe("USD");
  });

  it("non-admin cannot re-pin a row already on a known, non-default market", async () => {
    const row = await seed("UPG-KEEP", "equity", "US", "USD");
    const res = await post(await token("upg-user-4"), {
      symbol: "UPG-KEEP",
      market: "US",
      assetClass: "equity",
      unit: "shares",
      currency: "USD",
      name: "UPG-KEEP",
      isin: "US5949181045",
    });
    expect(res.statusCode).toBe(201);
    const after = await reload(row.id);
    expect(after.market).toBe("US");
    // Only the null ISIN back-fill (tier 1) applies.
    expect(after.assetClass).toBe("equity");
  });
});
