import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
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

describe("local auth routes", () => {
  beforeAll(async () => {
    process.env.AUTH_LOCAL_SECRET = LOCAL_SECRET;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp();
    testUserId = await seedUser("local-test@example.com", "secure-password");
  });

  afterAll(async () => {
    await app.db.delete(users).where(eq(users.email, "local-test@example.com"));
    await app.close();
    await closeDb();
    delete process.env.AUTH_LOCAL_SECRET;
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
    it("sets a password for a user with no existing password", async () => {
      const [fresh] = await app.db
        .insert(users)
        .values({
          authSub: "local|nopwd@example.com",
          email: "nopwd@example.com",
          name: "No Password",
        })
        .returning();

      const pat = await patForUser(fresh.id);
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/set-password",
        headers: auth(pat),
        payload: { newPassword: "new-strong-password" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      // Verify login works with the new password
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/local/login",
        payload: { email: "nopwd@example.com", password: "new-strong-password" },
      });
      expect(loginRes.statusCode).toBe(200);

      await app.db.delete(users).where(eq(users.email, "nopwd@example.com"));
    });

    it("rejects if user already has a password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/set-password",
        headers: auth(await patForUser(testUserId)),
        payload: { newPassword: "another-password" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("password_already_set");
    });
  });

  describe("POST /auth/local/change-password", () => {
    it("changes password with valid current password", async () => {
      const pat = await patForUser(testUserId);
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/change-password",
        headers: auth(pat),
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
      const pat = await patForUser(testUserId);
      const res = await app.inject({
        method: "POST",
        url: "/auth/local/change-password",
        headers: auth(pat),
        payload: { currentPassword: "wrong", newPassword: "anything" },
      });
      expect(res.statusCode).toBe(401);
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
