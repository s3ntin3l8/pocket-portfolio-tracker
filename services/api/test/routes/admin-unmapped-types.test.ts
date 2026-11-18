import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { generateKeyPair, SignJWT } from "jose";
import { screenshotImports, users } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb, getDb } from "../../src/db/client.js";

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

function issue(eventType: string) {
  return {
    code: "unmapped_event_type",
    eventType,
    severity: "attention",
    message: `unmapped event type: ${eventType}`,
    raw: { amount: -1 },
  };
}

async function stage(userId: string, status: "draft" | "discarded", eventType: string) {
  await getDb()
    .insert(screenshotImports)
    .values({
      userId,
      parser: "pytr",
      status,
      parsedJson: { drafts: [], errors: [issue(eventType)] },
    });
}

describe("GET /admin/imports/unmapped-types", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.AUTHENTIK_ADMIN_GROUP;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("rejects an unauthenticated call (401) and a non-admin (403)", async () => {
    const anon = await app.inject({ method: "GET", url: "/admin/imports/unmapped-types" });
    expect(anon.statusCode).toBe(401);
    const plain = await app.inject({
      method: "GET",
      url: "/admin/imports/unmapped-types",
      headers: auth(await token("um-plain")),
    });
    expect(plain.statusCode).toBe(403);
  });

  it("returns another user's gaps per user, skipping discarded imports and users with none", async () => {
    // Materialise the users by hitting an authenticated route.
    const other = await token("um-other");
    const clean = await token("um-clean");
    const admin = await token("um-admin", [ADMIN_GROUP]);
    for (const t of [other, clean, admin]) {
      await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    }
    const idOf = async (email: string) =>
      (await getDb().select().from(users).where(eq(users.email, email)))[0].id;
    const otherId = await idOf("um-other@example.com");
    const cleanId = await idOf("um-clean@example.com");

    await stage(otherId, "draft", "IPO_X");
    await stage(otherId, "draft", "IPO_X");
    await stage(otherId, "discarded", "GHOST");
    await stage(cleanId, "discarded", "GHOST");

    const res = await app.inject({
      method: "GET",
      url: "/admin/imports/unmapped-types",
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      userId: string;
      email: string;
      types: { eventType: string | null; count: number }[];
    }[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ userId: otherId, email: "um-other@example.com" });
    expect(body[0].types).toEqual([expect.objectContaining({ eventType: "IPO_X", count: 2 })]);
  });
});
