import fp from "fastify-plugin";
import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { users } from "@portfolio/db";
import {
  hashPassword,
  verifyPassword,
  timingSafeVerifyPassword,
  requireUser,
} from "../plugins/auth.js";

const LOCAL_JWT_EXPIRY = "7d";
const MIN_PASSWORD_LENGTH = 8;

/** Zod schemas for request validation. */
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

const setPasswordSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

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
    return;
  }

  const signingKey = new TextEncoder().encode(localSecret);

  async function signLocalJwt(sub: string, email: string): Promise<string> {
    return new SignJWT({ sub, email })
      .setProtectedHeader({ alg: "HS256" })
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
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }

      const { email, password } = parsed.data;
      const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);

      // timingSafeVerifyPassword pays the scrypt cost even when no user/passwordHash
      // exists, so both "no such user" and "wrong password" paths take ~same time.
      if (!user || !timingSafeVerifyPassword(password, user.passwordHash)) {
        return reply.code(401).send({ error: "Invalid email or password" });
      }

      const token = await signLocalJwt(`local|${email}`, email);

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

      const { currentPassword, newPassword } = parsed.data;
      const { id } = requireUser(request);

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user?.passwordHash) {
        timingSafeVerifyPassword(currentPassword, null); // mask timing
        return reply.code(400).send({ error: "no_local_password_set" });
      }

      if (!verifyPassword(currentPassword, user.passwordHash)) {
        return reply.code(401).send({ error: "Invalid password" });
      }

      await app.db
        .update(users)
        .set({ passwordHash: hashPassword(newPassword) })
        .where(eq(users.id, id));

      return { ok: true };
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
      const { id } = requireUser(request);

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (user?.passwordHash) {
        return reply.code(400).send({ error: "password_already_set" });
      }

      await app.db
        .update(users)
        .set({ passwordHash: hashPassword(newPassword) })
        .where(eq(users.id, id));

      return { ok: true };
    },
  );
});
