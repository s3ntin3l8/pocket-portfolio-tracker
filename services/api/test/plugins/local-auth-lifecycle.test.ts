/**
 * Audit A12: local JWT iss/aud binding and PAT revocation on password change.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";
import { users, apiTokens } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import {
  hashPassword,
  hashToken,
  PAT_PREFIX,
  LOCAL_JWT_ISSUER,
  LOCAL_JWT_AUDIENCE,
} from "../../src/plugins/auth.js";

const LOCAL_SECRET = randomBytes(24).toString("base64url");
// Generated, never a literal: keeps credential-looking strings out of the source.
const CURRENT_PW = randomBytes(9).toString("hex");
const NEXT_PW = randomBytes(9).toString("hex");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

function sign(opts: { sub: string; email: string; iss?: string; aud?: string }) {
  let jwt = new SignJWT({ email: opts.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.sub)
    .setIssuedAt()
    .setExpirationTime("1h");
  if (opts.iss) jwt = jwt.setIssuer(opts.iss);
  if (opts.aud) jwt = jwt.setAudience(opts.aud);
  return jwt.sign(new TextEncoder().encode(LOCAL_SECRET));
}

const signLocal = (email: string) =>
  sign({ sub: `local|${email}`, email, iss: LOCAL_JWT_ISSUER, aud: LOCAL_JWT_AUDIENCE });

async function seed(email: string): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({ authSub: `local|${email}`, email, passwordHash: hashPassword(CURRENT_PW) })
    .returning();
  const secret = `${PAT_PREFIX}${randomBytes(32).toString("base64url")}`;
  await app.db.insert(apiTokens).values({
    userId: u.id,
    name: "t",
    scope: "write",
    tokenHash: hashToken(secret),
    tokenPrefix: secret.slice(0, 12),
  });
  return u.id;
}

const tokenCount = async (id: string) =>
  (await app.db.select().from(apiTokens).where(eq(apiTokens.userId, id))).length;

describe("local auth lifecycle (A12)", () => {
  beforeAll(async () => {
    process.env.AUTH_LOCAL_SECRET = LOCAL_SECRET;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTH_LOCAL_SECRET;
    delete process.env.RATE_LIMIT_MAX;
  });

  it("stamps iss/aud on tokens issued by /auth/local/login", async () => {
    const email = "lifecycle-login@example.com";
    await seed(email);
    const res = await app.inject({
      method: "POST",
      url: "/auth/local/login",
      payload: { email, password: CURRENT_PW },
    });
    expect(res.statusCode).toBe(200);
    expect(decodeJwt(res.json().accessToken)).toMatchObject({
      iss: LOCAL_JWT_ISSUER,
      aud: LOCAL_JWT_AUDIENCE,
    });
  });

  it("accepts correctly-scoped tokens and rejects missing or wrong iss/aud", async () => {
    const email = "lifecycle-claims@example.com";
    await seed(email);
    const sub = `local|${email}`;
    const ok = await app.inject({
      method: "GET",
      url: "/me",
      headers: auth(await signLocal(email)),
    });
    expect(ok.statusCode).toBe(200);
    for (const bad of [
      await sign({ sub, email }),
      await sign({ sub, email, iss: "someone-else", aud: LOCAL_JWT_AUDIENCE }),
      await sign({ sub, email, iss: LOCAL_JWT_ISSUER, aud: "other-service" }),
    ]) {
      const res = await app.inject({ method: "GET", url: "/me", headers: auth(bad) });
      expect(res.statusCode).toBe(401);
    }
  });

  it("revokes the user's PATs on change-password by default", async () => {
    const email = "lifecycle-revoke@example.com";
    const id = await seed(email);
    const res = await app.inject({
      method: "POST",
      url: "/auth/local/change-password",
      headers: auth(await signLocal(email)),
      payload: { currentPassword: CURRENT_PW, newPassword: NEXT_PW },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, revokedTokens: 1 });
    expect(await tokenCount(id)).toBe(0);
  });

  it("keeps PATs when keepTokens: true is passed", async () => {
    const email = "lifecycle-keep@example.com";
    const id = await seed(email);
    const res = await app.inject({
      method: "POST",
      url: "/auth/local/change-password",
      headers: auth(await signLocal(email)),
      payload: { currentPassword: CURRENT_PW, newPassword: NEXT_PW, keepTokens: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, revokedTokens: 0 });
    expect(await tokenCount(id)).toBe(1);
  });
});
