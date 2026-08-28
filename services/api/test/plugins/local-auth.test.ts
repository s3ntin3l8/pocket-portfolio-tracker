import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { generateKeyPair, SignJWT } from "jose";
import { users, apiTokens } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import {
  hashPassword,
  verifyPassword,
  timingSafeVerifyPassword,
  PAT_PREFIX,
  hashToken,
} from "../../src/plugins/auth.js";
import { randomBytes } from "node:crypto";

const LOCAL_SECRET = "test-local-secret-for-tests-only"; // pragma: allowlist secret
const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let testUserId: string;

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

// --- Password hash unit tests ---

describe("hashPassword / verifyPassword", () => {
  it("produces a scrypt:salt:hash string", () => {
    const hashed = hashPassword("test-password");
    const parts = hashed.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toHaveLength(32); // 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(128); // 64 bytes = 128 hex chars
  });

  it("verifies the correct password", () => {
    const hashed = hashPassword("correct-password");
    expect(verifyPassword("correct-password", hashed)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const hashed = hashPassword("real-password");
    expect(verifyPassword("wrong-password", hashed)).toBe(false);
  });

  it("produces different hashes for the same password (different salt)", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects a malformed stored hash", () => {
    expect(verifyPassword("pwd", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("pwd", "invalid:salt")).toBe(false);
  });
});

describe("timingSafeVerifyPassword", () => {
  it("returns false for null/undefined stored hash (without throwing)", () => {
    expect(timingSafeVerifyPassword("any-password", null)).toBe(false);
    expect(timingSafeVerifyPassword("any-password", undefined)).toBe(false);
  });

  it("returns true for the correct password", () => {
    const hashed = hashPassword("correct");
    expect(timingSafeVerifyPassword("correct", hashed)).toBe(true);
  });

  it("returns false for the wrong password", () => {
    const hashed = hashPassword("real");
    expect(timingSafeVerifyPassword("wrong", hashed)).toBe(false);
  });
});

// --- Route integration tests ---

async function seedUser(email: string, password: string): Promise<string> {
  const pwh = hashPassword(password);
  const [user] = await app.db
    .insert(users)
    .values({
      authSub: `local|${email}`,
      email,
      name: "Test User",
      passwordHash: pwh,
    })
    .returning();
  return user.id;
}

async function patForUser(userId: string): Promise<string> {
  const secret = `${PAT_PREFIX}${randomBytes(32).toString("base64url")}`;
  await app.db.insert(apiTokens).values({
    userId,
    name: "test-pat",
    scope: "write",
    tokenHash: hashToken(secret),
    tokenPrefix: secret.slice(0, 12),
  });
  return secret;
}

/** Log in via the real route to get an interactive local-auth JWT (authMethod: "local"). */
async function localJwtFor(email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth/local/login",
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

/** Mint an OIDC-style JWT (authMethod: "jwt") against the injected test key, simulating
 *  an interactive Authentik session — used for the "OIDC user attaching a local password"
 *  scenario, which set-password is explicitly meant to support. */
async function oidcJwtFor(sub: string, key: CryptoKey): Promise<string> {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

describe("local auth routes", () => {
  let oidcKey: CryptoKey;

  beforeAll(async () => {
    process.env.AUTH_LOCAL_SECRET = LOCAL_SECRET;
    // Both auth methods configured at once — set-password's advertised use case is an
    // OIDC user attaching a local password, so tests need a way to authenticate as an
    // interactive OIDC session too.
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    const kp = await generateKeyPair("ES256");
    oidcKey = kp.privateKey;
    app = await buildApp({ authKey: kp.publicKey });
    testUserId = await seedUser("local-test@example.com", "secure-password");
  });

  afterAll(async () => {
    await app.db.delete(users).where(eq(users.email, "local-test@example.com"));
    await app.close();
    await closeDb();
    delete process.env.AUTH_LOCAL_SECRET;
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  describe("POST /auth/local/login", () => {
    it("returns 200 + JWT for valid credentials", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "local-test@example.com", password: "secure-password" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("accessToken");
      expect(body.accessToken).toMatch(/^eyJ/); // JWT format
      expect(body.email).toBe("local-test@example.com");
      expect(body.id).toBe(testUserId);
    });

    it("returns 401 for wrong password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "local-test@example.com", password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid email or password");
    });

    it("returns 401 for unknown email (same error as wrong password)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "unknown@example.com", password: "any-password" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid email or password");
    });

    it("returns 400 for invalid input", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "not-an-email", password: "" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /auth/local/set-password", () => {
    it("sets a password for a user with no existing password (OIDC user attaching a local password)", async () => {
      const sub = "oidc-nopwd-user";
      await app.db.insert(users).values({
        authSub: sub,
        email: "nopwd@example.com",
        name: "No Password",
      });

      const oidcJwt = await oidcJwtFor(sub, oidcKey);
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/set-password",
        headers: auth(oidcJwt),
        payload: { newPassword: "new-strong-password" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // Verify login works with the new password, and that the resulting token round-trips
      // through an authenticated request instead of colliding on users_email_unique —
      // the login route must sign the row's own authSub, not a synthetic local|<email>.
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "nopwd@example.com", password: "new-strong-password" },
      });
      expect(loginRes.statusCode).toBe(200);

      const meRes = await app.inject({
        method: "GET",
        url: "/me",
        headers: auth(loginRes.json().accessToken),
      });
      expect(meRes.statusCode).toBe(200);
      expect(meRes.json().email).toBe("nopwd@example.com");

      await app.db.delete(users).where(eq(users.email, "nopwd@example.com"));
    });

    it("rejects if user already has a password", async () => {
      const oidcJwt = await oidcJwtFor("local|local-test@example.com", oidcKey);
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/set-password",
        headers: auth(oidcJwt),
        payload: { newPassword: "another-password" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("password_already_set");
    });

    it("rejects a PAT — set-password requires an interactive session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/set-password",
        headers: auth(await patForUser(testUserId)),
        payload: { newPassword: "another-password" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("interactive_session_required");
    });
  });

  describe("POST /auth/local/change-password", () => {
    it("changes password with valid current password", async () => {
      const sessionJwt = await localJwtFor("local-test@example.com", "secure-password");
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/change-password",
        headers: auth(sessionJwt),
        payload: { currentPassword: "secure-password", newPassword: "updated-password" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // Verify login with the new password
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "local-test@example.com", password: "updated-password" },
      });
      expect(loginRes.statusCode).toBe(200);

      // Restore original password
      await app.db
        .update(users)
        .set({ passwordHash: hashPassword("secure-password") })
        .where(eq(users.id, testUserId));
    });

    it("rejects wrong current password", async () => {
      const sessionJwt = await localJwtFor("local-test@example.com", "secure-password");
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/change-password",
        headers: auth(sessionJwt),
        payload: { currentPassword: "wrong", newPassword: "anything" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a PAT — change-password requires an interactive session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/change-password",
        headers: auth(await patForUser(testUserId)),
        payload: { currentPassword: "secure-password", newPassword: "anything" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("interactive_session_required");
    });
  });

  describe("email case handling", () => {
    it("logs in with a different-case email than what was stored", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "Local-Test@Example.com", password: "secure-password" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().email).toBe("local-test@example.com");
    });
  });
});

describe("PAT-first auth (no OIDC, no AUTH_LOCAL_SECRET)", () => {
  let patApp: App;

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "10000";
    // No AUTH_LOCAL_SECRET, no AUTHENTIK_ISSUER — PAT-only mode
    patApp = await buildApp();
  });

  afterAll(async () => {
    await patApp.close();
    await closeDb();
    delete process.env.RATE_LIMIT_MAX;
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await patApp.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });

  it("authenticates with a valid PAT", async () => {
    const secret = `${PAT_PREFIX}${randomBytes(32).toString("base64url")}`;
    const [user] = await patApp.db
      .insert(users)
      .values({ authSub: "pat-test-user", email: "pat-test@example.com", name: "PAT User" })
      .returning();
    await patApp.db.insert(apiTokens).values({
      userId: user.id,
      name: "test",
      scope: "write",
      tokenHash: hashToken(secret),
      tokenPrefix: secret.slice(0, 12),
    });

    const res = await patApp.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(res.statusCode).toBe(200);

    await patApp.db.delete(users).where(eq(users.id, user.id));
  });

  it("returns 503 when neither PAT nor any JWT method is configured and no token sent", async () => {
    const res = await patApp.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer invalid-pat-token" },
    });
    expect(res.statusCode).toBe(503); // no auth mechanism configured
  });
});
