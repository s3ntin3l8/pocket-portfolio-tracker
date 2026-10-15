import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { apiTokens, users } from "@portfolio/db";
import {
  LOCAL_JWT_AUDIENCE,
  LOCAL_JWT_ISSUER,
  hashPassword,
  verifyPassword,
  timingSafeVerifyPassword,
  requireUser,
  isDelegated,
} from "../plugins/auth.js";

const LOCAL_JWT_EXPIRY = "7d";
const MIN_PASSWORD_LENGTH = 8;

/** Zod schemas for request validation. */
import { z } from "zod";

// Normalize email at every entry point (login, setup, seeding) so "Demo@x.com" and
// "demo@x.com" are the same account instead of a case-sensitive 401.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const loginSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
  // Personal access tokens are revoked on a password change unless explicitly kept.
  keepTokens: z.boolean().optional(),
});

const setPasswordSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

/**
 * Per-account login throttle (in memory, per process): at most LOGIN_FAIL_MAX failed
 * attempts per normalized email per LOGIN_FAIL_WINDOW_MS, cleared on a successful login.
 * Complements the per-IP route limit — a distributed guesser that rotates IPs still hits
 * this, while one noisy IP can no longer lock out other users' accounts.
 */
const LOGIN_FAIL_MAX = 5;
const LOGIN_FAIL_WINDOW_MS = 60_000;
const LOGIN_FAIL_MAX_KEYS = 10_000;

export function createLoginThrottle(now: () => number = Date.now) {
  const failures = new Map<string, number[]>();

  function recent(email: string): number[] {
    const cutoff = now() - LOGIN_FAIL_WINDOW_MS;
    const live = (failures.get(email) ?? []).filter((t) => t > cutoff);
    if (live.length === 0) failures.delete(email);
    else failures.set(email, live);
    return live;
  }

  return {
    /** Seconds until the next attempt is allowed, or 0 when not throttled. */
    retryAfter(email: string): number {
      const live = recent(email);
      if (live.length < LOGIN_FAIL_MAX) return 0;
      return Math.max(1, Math.ceil((live[0]! + LOGIN_FAIL_WINDOW_MS - now()) / 1000));
    },
    recordFailure(email: string): void {
      const live = recent(email);
      live.push(now());
      failures.set(email, live);
      if (failures.size > LOGIN_FAIL_MAX_KEYS) {
        // Bound memory against an attacker spraying random emails: drop the oldest key.
        const oldest = failures.keys().next().value;
        if (oldest !== undefined) failures.delete(oldest);
      }
    },
    clear(email: string): void {
      failures.delete(email);
    },
  };
}

/**
 * Local password auth routes. Only functional when AUTH_LOCAL_SECRET is configured in
 * the environment — these routes return 503 "auth_not_configured" otherwise.
 */
export const authRoute = fp(async (app) => {
  const localSecret = app.config.AUTH_LOCAL_SECRET;
  if (!localSecret) {
    const notConfigured = async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(503).send({ error: "auth_not_configured" });
    };
    app.post("/auth/local/login", notConfigured);
    app.post("/auth/local/change-password", { preHandler: app.authenticate }, notConfigured);
    app.post("/auth/local/set-password", { preHandler: app.authenticate }, notConfigured);
    app.post("/auth/local/setup", notConfigured);
    // Always resolves — never 404/503 — so this endpoint can't be used to fingerprint
    // which auth mode a deployment runs. "Not local auth" reads the same as "already set up".
    app.get("/auth/local/setup-status", async () => ({ needsSetup: false }));
    return;
  }

  const signingKey = new TextEncoder().encode(localSecret);
  const loginThrottle = createLoginThrottle();

  async function signLocalJwt(sub: string, email: string): Promise<string> {
    return new SignJWT({ sub, email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(LOCAL_JWT_ISSUER)
      .setAudience(LOCAL_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(LOCAL_JWT_EXPIRY)
      .sign(signingKey);
  }

  /**
   * POST /auth/local/login
   * Authenticate with email + password. Returns a signed JWT and user profile.
   * Same error for missing user vs wrong password to prevent email enumeration.
   * Rate-limited to prevent brute-force attacks (10 req/min per IP).
   */
  app.post(
    "/auth/local/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }

      const { email, password } = parsed.data;

      const wait = loginThrottle.retryAfter(email);
      if (wait > 0) {
        return reply
          .code(429)
          .header("retry-after", String(wait))
          .send({ error: `Too many login attempts, retry in ${wait} seconds` });
      }

      const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);

      // timingSafeVerifyPassword pays the scrypt cost even when no user/passwordHash
      // exists, so both "no such user" and "wrong password" paths take ~same time.
      const validPassword = timingSafeVerifyPassword(password, user?.passwordHash ?? null);
      if (!user || !validPassword) {
        loginThrottle.recordFailure(email);
        return reply.code(401).send({ error: "Invalid email or password" });
      }
      loginThrottle.clear(email);

      // Sign the token with the row's OWN authSub, not a synthetic `local|${email}` —
      // `authenticate` resolves users by authSub (plugins/auth.ts), and a user that didn't
      // originate from local auth (an OIDC user, an admin seeded via seed.ts) has some other
      // authSub. Signing a mismatched sub here would make every later request 500 on
      // `users_email_unique` when `authenticate`'s JIT-insert collides with this row's email.
      const token = await signLocalJwt(user.authSub, email);

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        accessToken: token,
        expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
      };
    },
  );

  /**
   * POST /auth/local/change-password
   * Authenticated user changes their password. Requires current password verification.
   * Rate-limited to prevent guessing attacks (5 req/min per IP).
   */
  app.post(
    "/auth/local/change-password",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } }, preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }

      const { currentPassword, newPassword, keepTokens } = parsed.data;
      const { id, authMethod } = requireUser(request);
      // Only from an interactive session — a leaked PAT must not be able to change the
      // password it was minted under (mirrors /me/tokens' "no credential self-
      // perpetuation" guard in me.ts).
      if (isDelegated({ authMethod })) {
        return reply.code(403).send({ error: "interactive_session_required" });
      }

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user?.passwordHash) {
        timingSafeVerifyPassword(currentPassword, null); // mask timing
        return reply.code(400).send({ error: "no_local_password_set" });
      }

      if (!verifyPassword(currentPassword, user.passwordHash)) {
        // 400, not 401: the web client treats any 401 as "session gone" and bounces to sign-in,
        // but here the session is fine — the user just mistyped the current password.
        return reply.code(400).send({ error: "invalid_current_password" });
      }

      await app.db
        .update(users)
        .set({ passwordHash: hashPassword(newPassword), passwordChangedAt: new Date() })
        .where(eq(users.id, id));

      // A password change is the "my credentials may be compromised" signal: PATs minted
      // earlier would otherwise outlive it. Opt out with keepTokens for rotation-only changes.
      let revokedTokens = 0;
      if (!keepTokens) {
        const revoked = await app.db
          .delete(apiTokens)
          .where(eq(apiTokens.userId, id))
          .returning({ id: apiTokens.id });
        revokedTokens = revoked.length;
      }

      return { ok: true, revokedTokens };
    },
  );

  /**
   * POST /auth/local/set-password
   * Authenticated user sets an initial password for local auth. Only works when the
   * user has no existing passwordHash (e.g. an OIDC user attaching a local password).
   * Use /auth/local/change-password once a password is already set.
   */
  app.post(
    "/auth/local/set-password",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } }, preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = setPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }

      const { newPassword } = parsed.data;
      const { id, authMethod } = requireUser(request);
      // Same guard as change-password: a PAT cannot plant a password on the account it
      // was minted under. Without this, a leaked read/write PAT for an OIDC-only user
      // (passwordHash always null) could grant itself interactive email/password access.
      if (isDelegated({ authMethod })) {
        return reply.code(403).send({ error: "interactive_session_required" });
      }

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (user?.passwordHash) {
        return reply.code(400).send({ error: "password_already_set" });
      }

      await app.db
        .update(users)
        .set({ passwordHash: hashPassword(newPassword), passwordChangedAt: new Date() })
        .where(eq(users.id, id));

      return { ok: true };
    },
  );

  /**
   * GET /auth/local/setup-status
   * Whether the first-run admin bootstrap (POST /auth/local/setup) is still available.
   * Unauthenticated by design — the login screen needs it before anyone can sign in.
   * `needsSetup` is "zero rows in `users`", so it closes itself the moment a user exists
   * via any path (seed, OIDC login, or setup itself). Always resolves for this deployment
   * shape (never 404/503) so the response can't be used to fingerprint auth mode.
   */
  app.get(
    "/auth/local/setup-status",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => request.ip,
        },
      },
    },
    async () => {
      const [{ count }] = await app.db.select({ count: sql<number>`count(*)` }).from(users);
      return { needsSetup: Number(count) === 0 };
    },
  );

  // Arbitrary fixed key for the setup-bootstrap advisory lock (see below) — any int8
  // works as long as nothing else in the app claims it; nothing else does.
  const SETUP_LOCK_KEY = 8_224_601;

  /**
   * POST /auth/local/setup
   * Create the first user — as an admin — when the deployment has none yet. This is the
   * self-host bootstrap for a deployment with no Authentik and no seeded database: without
   * it the only way to get a local-password user is the destructive `make seed-demo-login`
   * script. Closes itself permanently once any user exists.
   *
   * Atomic against concurrent callers via a transaction-scoped Postgres advisory lock
   * (released automatically at commit/rollback) wrapping a check-then-insert — plain
   * Drizzle `insert().select()` can't express "insert these literal values only if the
   * table is empty" because it requires the select's column set to exactly match the
   * target table's full column list, not the subset this insert needs.
   */
  app.post(
    "/auth/local/setup",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          keyGenerator: (request: FastifyRequest) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const { email, password } = parsed.data;
      if (password.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({
          error: "validation_error",
          issues: [{ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }],
        });
      }

      const authSub = `local|${email}`;
      const passwordHash = hashPassword(password);

      const created = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
        const [{ count }] = await tx.select({ count: sql<number>`count(*)` }).from(users);
        if (Number(count) > 0) return null;
        const [row] = await tx
          .insert(users)
          .values({ authSub, email, name: "Admin", passwordHash, isAdmin: true })
          .returning();
        return row;
      });

      if (!created) {
        return reply.code(409).send({ error: "setup_already_done" });
      }

      const token = await signLocalJwt(created.authSub, created.email);
      return {
        id: created.id,
        email: created.email,
        name: created.name,
        accessToken: token,
        expiresAt: Math.floor(Date.now() / 1000) + 7 * 86_400,
      };
    },
  );
});
