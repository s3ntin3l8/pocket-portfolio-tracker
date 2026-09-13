/**
 * Route tests for Indonesian retail bond (ORI/SR) support:
 *  - POST /instruments round-trips the four bond terms (faceValue, couponRate,
 *    couponSchedule, maturityDate) through instrumentInputSchema.
 *  - PATCH /instruments/:id updates them and stays admin-gated (403 for non-admins).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
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

describe("POST /instruments — bond terms", () => {
  it("round-trips faceValue/couponRate/couponSchedule/maturityDate", async () => {
    const t = await token("bond-user-1");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "SR021T3",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "Sukuk Negara Ritel seri SR021T3",
        faceValue: "1000000",
        couponRate: "0.0635",
        couponSchedule: "monthly",
        maturityDate: "2027-09-10",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.faceValue).toBe("1000000");
    expect(body.couponRate).toBe("0.0635");
    expect(body.couponSchedule).toBe("monthly");
    expect(body.maturityDate).toBe("2027-09-10");
  });

  it("rejects bond terms on a non-bond assetClass", async () => {
    const t = await token("bond-user-2");
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol: "BBCA-BOGUS",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "Bank Central Asia",
        faceValue: "1000000",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /instruments/:id — bond terms, admin-gated", () => {
  async function createBond(sub: string, symbol: string) {
    const t = await token(sub);
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol,
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: symbol,
      },
    });
    return res.json();
  }

  it("updates bond terms for an admin", async () => {
    const created = await createBond("bond-user-3", "ORI026");
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${created.id}`,
      headers: auth(await token("bond-admin-1", [ADMIN_GROUP])),
      payload: {
        faceValue: "1000000",
        couponRate: "0.0575",
        couponSchedule: "monthly",
        maturityDate: "2028-10-15",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.faceValue).toBe("1000000");
    expect(body.couponRate).toBe("0.0575");
  });

  it("returns 403 for a non-admin", async () => {
    const created = await createBond("bond-user-4", "ORI027");
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${created.id}`,
      headers: auth(await token("bond-user-5")),
      payload: { faceValue: "1000000" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PUT /instruments/:id/manual-price — not admin-gated", () => {
  async function createBond(sub: string, symbol: string) {
    const t = await token(sub);
    const res = await app.inject({
      method: "POST",
      url: "/instruments",
      headers: auth(t),
      payload: {
        symbol,
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: symbol,
        faceValue: "1000000",
      },
    });
    return res.json();
  }

  it("sets a manual price for a non-admin user and stamps manualPriceAt", async () => {
    const created = await createBond("mp-user-1", "SR030T3");
    const res = await app.inject({
      method: "PUT",
      url: `/instruments/${created.id}/manual-price`,
      headers: auth(await token("mp-user-1")),
      payload: { price: "1013500" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.manualPrice).toBe("1013500");
    expect(body.manualPriceAt).toBeTruthy();
  });

  it("clears a manual price when price is null", async () => {
    const created = await createBond("mp-user-2", "SR030T5");
    await app.inject({
      method: "PUT",
      url: `/instruments/${created.id}/manual-price`,
      headers: auth(await token("mp-user-2")),
      payload: { price: "1013500" },
    });
    const res = await app.inject({
      method: "PUT",
      url: `/instruments/${created.id}/manual-price`,
      headers: auth(await token("mp-user-2")),
      payload: { price: null },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.manualPrice).toBeNull();
    expect(body.manualPriceAt).toBeNull();
  });

  it("returns 404 for an unknown instrument id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/instruments/00000000-0000-0000-0000-000000000000/manual-price",
      headers: auth(await token("mp-user-3")),
      payload: { price: "100" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a negative or zero price with 400 — this is shared reference data every holder trusts", async () => {
    const created = await createBond("mp-user-4", "SR031T3");
    for (const bad of ["-500", "0"]) {
      const res = await app.inject({
        method: "PUT",
        url: `/instruments/${created.id}/manual-price`,
        headers: auth(await token("mp-user-4")),
        payload: { price: bad },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
