/**
 * Audit A12: admin set-password vs OIDC-only users and personal access tokens.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { generateKeyPair, SignJWT } from "jose";
import { users, apiTokens, adminAuditLog } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { hashPassword, hashToken } from "../../src/plugins/auth.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
const ADMIN_GROUP = "portfolio-admins";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string, groups: string[] = []) {
  return new SignJWT({ email: `${sub}@test.example`, groups })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function seed(authSub: string, withLocalPassword: boolean): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      authSub,
      email: `${randomBytes(6).toString("hex")}@test.example`,
      passwordHash: withLocalPassword ? hashPassword(randomBytes(9).toString("hex")) : null,
    })
    .returning();
  const secret = `pt_${randomBytes(24).toString("base64url")}`;
  await app.db.insert(apiTokens).values({
    userId: u.id,
    name: "t",
    scope: "read",
    tokenHash: hashToken(secret),
    tokenPrefix: secret.slice(0, 12),
  });
  return u.id;
}

const tokenCount = async (id: string) =>
  (await app.db.select().from(apiTokens).where(eq(apiTokens.userId, id))).length;

describe("POST /admin/users/:id/set-password (A12)", () => {
  let adminT: string;

  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    privateKey = kp.privateKey;
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.AUTHENTIK_ADMIN_GROUP = ADMIN_GROUP;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
    adminT = await token("set-password-admin", [ADMIN_GROUP]);
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.AUTHENTIK_ADMIN_GROUP;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("refuses an OIDC-only user unless allowLocalFallback is passed", async () => {
    const id = await seed("oidc|only-user", false);
    const refused = await app.inject({
      method: "POST",
      url: `/admin/users/${id}/set-password`,
      headers: auth(adminT),
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe("oidc_user_requires_allow_local_fallback");
    const [untouched] = await app.db.select().from(users).where(eq(users.id, id));
    expect(untouched.passwordHash).toBeNull();
    expect(await tokenCount(id)).toBe(1);

    const allowed = await app.inject({
      method: "POST",
      url: `/admin/users/${id}/set-password`,
      headers: auth(adminT),
      payload: { allowLocalFallback: true },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("does not need the flag for a user who already has a local password", async () => {
    const id = await seed("local|has-password", true);
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${id}/set-password`,
      headers: auth(adminT),
    });
    expect(res.statusCode).toBe(200);
  });

  it("revokes the user's PATs by default and keeps them with keepTokens", async () => {
    const revokedId = await seed("local|revoke-me", true);
    const keptId = await seed("local|keep-me", true);
    const revoke = await app.inject({
      method: "POST",
      url: `/admin/users/${revokedId}/set-password`,
      headers: auth(adminT),
    });
    const keep = await app.inject({
      method: "POST",
      url: `/admin/users/${keptId}/set-password`,
      headers: auth(adminT),
      payload: { keepTokens: true },
    });
    expect(revoke.statusCode).toBe(200);
    expect(keep.statusCode).toBe(200);
    expect(await tokenCount(revokedId)).toBe(0);
    expect(await tokenCount(keptId)).toBe(1);
  });

  it("combines allowLocalFallback with default PAT revocation and audits both", async () => {
    const id = await seed("oidc|combo-user", false);
    const res = await app.inject({
      method: "POST",
      url: `/admin/users/${id}/set-password`,
      headers: auth(adminT),
      payload: { allowLocalFallback: true, keepTokens: false },
    });
    expect(res.statusCode).toBe(200);
    expect(await tokenCount(id)).toBe(0);
    const [row] = await app.db.select().from(users).where(eq(users.id, id));
    expect(row.passwordHash).not.toBeNull();
    const [audit] = await app.db.select().from(adminAuditLog).where(eq(adminAuditLog.target, id));
    expect(audit.meta).toEqual({ keepTokens: false, allowLocalFallback: true, oidcOnly: true });
  });
});
