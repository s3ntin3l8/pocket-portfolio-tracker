/**
 * PATCH /instruments/:id — Teilfreistellung override (`partialExemptionRate`): admin-gated,
 * validated as a 0–1 fraction, nullable to clear.
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

const ADMIN = [ADMIN_GROUP];

async function createEtf(sub: string, symbol: string) {
  const res = await app.inject({
    method: "POST",
    url: "/instruments",
    headers: auth(await token(sub)),
    payload: {
      symbol,
      market: "XETRA",
      assetClass: "etf",
      unit: "shares",
      currency: "EUR",
      name: symbol,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("PATCH /instruments/:id — partialExemptionRate", () => {
  it("sets and clears the override as an admin", async () => {
    const id = await createEtf("tf-creator", "TF-ROUTE-1");
    const admin = await token("tf-admin", ADMIN);
    const set = await app.inject({
      method: "PATCH",
      url: `/instruments/${id}`,
      headers: auth(admin),
      payload: { partialExemptionRate: "0.15" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().partialExemptionRate).toBe("0.15");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/instruments/${id}`,
      headers: auth(admin),
      payload: { partialExemptionRate: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().partialExemptionRate).toBeNull();
  });

  it.each(["1.5", "-0.1", "abc"])("rejects %s with 400", async (bad) => {
    const id = await createEtf("tf-creator2", `TF-BAD-${bad}`);
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${id}`,
      headers: auth(await token("tf-admin2", ADMIN)),
      payload: { partialExemptionRate: bad },
    });
    expect(res.statusCode).toBe(400);
  });

  it("is admin-gated (403 for a non-admin)", async () => {
    const id = await createEtf("tf-creator3", "TF-ROUTE-3");
    const res = await app.inject({
      method: "PATCH",
      url: `/instruments/${id}`,
      headers: auth(await token("tf-plain")),
      payload: { partialExemptionRate: "0.30" },
    });
    expect(res.statusCode).toBe(403);
  });
});
