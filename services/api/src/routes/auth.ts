import fp from "fastify-plugin";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { users } from "@portfolio/db";
import { hashPassword, verifyPassword, requireUser } from "../plugins/auth.js";

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

/**
 * Local password auth routes. Only functional when AUTH_LOCAL_SECRET is configured in
 * the environment — these routes return 503 "auth_not_configured" otherwise.
 */
export const authRoute = fp(async (app) => {
  const localSecret = app.config.AUTH_LOCAL_SECRET;
  if (!localSecret) {
    // Not configured; register routes that always 503 so callers get a clear error
    // rather than a 404 that suggests the route doesn't exist at all.
    app.post("/auth/local/login", async (_request, reply) => {
      return reply.code(503).send({ error: "auth_not_configured" });
    });
    app.post(
      "/auth/local/change-password",
      { preHandler: app.authenticate },
      async (_request, reply) => {
        return reply.code(503).send({ error: "auth_not_configured" });
      },
    );
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
   */
  app.post("/auth/local/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
    }

    const { email, password } = parsed.data;
    const [user] = await app.db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user?.passwordHash) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    if (!verifyPassword(password, user.passwordHash)) {
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
  });

  /**
   * POST /auth/local/change-password
   * Authenticated user changes their password. Requires current password verification.
   */
  app.post(
    "/auth/local/change-password",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }

      const { currentPassword, newPassword } = parsed.data;
      const { id } = requireUser(request);

      const [user] = await app.db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!user?.passwordHash) {
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
});
