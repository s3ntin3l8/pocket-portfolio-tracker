import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, sql, ne, and } from "drizzle-orm";
import { z } from "zod";
import {
  users,
  portfolios,
  transactions,
  documents,
  apiTokens,
  adminAuditLog,
} from "@portfolio/db";
import { deleteStorageObjectsByKey } from "../../storage/receipts.js";
import { hashPassword } from "../../plugins/auth.js";
import { normalizeEmail } from "../auth.js";

const createUserSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  name: z.string().trim().min(1).optional(),
  isAdmin: z.boolean().optional().default(false),
});

const setAdminSchema = z.object({
  isAdmin: z.boolean(),
});

/** pw_ + 24 url-safe chars (~144 bits) — shown once, same shape as a PAT secret. */
function generateTempPassword(): string {
  return `pw_${randomBytes(18).toString("base64url")}`;
}

export function registerUsersRoutes(app: FastifyInstance) {
  app.get(
    "/admin/users",
    {
      config: { rateLimit: { max: 40, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async () => {
      const rows = await app.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          createdAt: users.createdAt,
          onboardingCompletedAt: users.onboardingCompletedAt,
          portfolioCount: sql<number>`count(distinct ${portfolios.id})`,
          transactionCount: sql<number>`count(distinct ${transactions.id})`,
          documentCount: sql<number>`count(distinct ${documents.id})`,
          storageBytes: sql<number>`coalesce((select sum(${documents.sizeBytes})
            from ${documents} where ${documents.userId} = ${users.id}), 0)`,
          tokenCount: sql<number>`count(distinct ${apiTokens.id})`,
        })
        .from(users)
        .leftJoin(portfolios, eq(portfolios.userId, users.id))
        .leftJoin(transactions, eq(transactions.portfolioId, portfolios.id))
        .leftJoin(documents, eq(documents.userId, users.id))
        .leftJoin(apiTokens, eq(apiTokens.userId, users.id))
        .groupBy(users.id)
        .orderBy(sql`${users.createdAt} desc`);

      return rows.map((r) => ({
        ...r,
        portfolioCount: Number(r.portfolioCount),
        transactionCount: Number(r.transactionCount),
        documentCount: Number(r.documentCount),
        storageBytes: Number(r.storageBytes),
        tokenCount: Number(r.tokenCount),
      }));
    },
  );

  /**
   * POST /admin/users
   * Admin-created user for local password auth — the second-and-later-user path once
   * POST /auth/local/setup has bootstrapped the first admin. Returns a generated temp
   * password ONCE (never stored in plaintext, never logged); the admin communicates it
   * to the new user out of band. This is also the recovery path in place of a
   * self-service forgot-password flow (there is no mailer in this project).
   */
  app.post(
    "/admin/users",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const { email, name, isAdmin } = parsed.data;

      const tempPassword = generateTempPassword();
      let created;
      try {
        [created] = await app.db
          .insert(users)
          .values({
            authSub: `local|${email}`,
            email,
            name: name ?? null,
            passwordHash: hashPassword(tempPassword),
            isAdmin,
          })
          .returning({ id: users.id, email: users.email, isAdmin: users.isAdmin });
      } catch (err) {
        // An existing OIDC or seeded user with the same email trips users_email_unique —
        // surface as a friendly 409 rather than a 500 (same pattern as mergers.ts).
        const e = err as { code?: string; cause?: { code?: string }; message?: string };
        if (
          e.code === "23505" ||
          e.cause?.code === "23505" ||
          /duplicate key|unique constraint/i.test(e.message ?? "")
        ) {
          return reply.code(409).send({ error: "email_already_exists" });
        }
        throw err;
      }

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "create_user",
        target: created.id,
        meta: { email, isAdmin },
      });

      return reply.code(201).send({ ...created, tempPassword });
    },
  );

  /**
   * POST /admin/users/:id/set-password
   * Admin resets another user's password — the recovery path for a locked-out local
   * user, standing in for a self-service forgot-password flow. Returns a generated temp
   * password ONCE and stamps passwordChangedAt so any of the user's existing local JWTs
   * (up to 7 days old) stop working immediately, not just future logins.
   */
  app.post(
    "/admin/users/:id/set-password",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const tempPassword = generateTempPassword();

      const [updated] = await app.db
        .update(users)
        .set({ passwordHash: hashPassword(tempPassword), passwordChangedAt: new Date() })
        .where(eq(users.id, id))
        .returning({ id: users.id, email: users.email });

      if (!updated) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "admin_set_password",
        target: id,
        meta: {},
      });

      return { ...updated, tempPassword };
    },
  );

  /**
   * PATCH /admin/users/:id/admin
   * Promote/demote local-auth admin status (users.isAdmin — OIDC admins derive theirs
   * from the Authentik group claim per-request and never read this column). Refuses to
   * demote the last remaining admin so a deployment can't lock itself out of /admin/*.
   */
  app.patch(
    "/admin/users/:id/admin",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = setAdminSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "validation_error", issues: parsed.error.issues });
      }
      const { isAdmin } = parsed.data;

      if (!isAdmin) {
        const [{ count }] = await app.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.isAdmin, true), ne(users.id, id)));
        if (Number(count) === 0) {
          return reply.code(400).send({ error: "cannot_demote_last_admin" });
        }
      }

      const [updated] = await app.db
        .update(users)
        .set({ isAdmin })
        .where(eq(users.id, id))
        .returning({ id: users.id, email: users.email, isAdmin: users.isAdmin });

      if (!updated) {
        return reply.code(404).send({ error: "user_not_found" });
      }

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: isAdmin ? "grant_admin" : "revoke_admin",
        target: id,
        meta: {},
      });

      return updated;
    },
  );

  app.post(
    "/admin/users/:id/revoke-tokens",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const { id } = request.params as { id: string };

      const [{ count }] = await app.db
        .select({ count: sql<number>`count(*)` })
        .from(apiTokens)
        .where(eq(apiTokens.userId, id));

      await app.db.delete(apiTokens).where(eq(apiTokens.userId, id));

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "revoke_user_tokens",
        target: id,
        meta: { revokedCount: Number(count) },
      });

      return { revoked: Number(count) };
    },
  );

  app.post(
    "/admin/users/:id/reset-onboarding",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async (request) => {
      const { id } = request.params as { id: string };

      await app.db.update(users).set({ onboardingCompletedAt: null }).where(eq(users.id, id));

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "reset_user_onboarding",
        target: id,
        meta: {},
      });

      return { reset: true };
    },
  );

  app.post(
    "/admin/users/:id/delete",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (id === request.user!.id) {
        return reply.code(400).send({ error: "cannot_delete_self" });
      }

      const docs = await app.db
        .select({ id: documents.id, storageKey: documents.storageKey })
        .from(documents)
        .where(eq(documents.userId, id));

      if (docs.length > 0) {
        await deleteStorageObjectsByKey(app, docs, `admin-delete-user-${id}`);
      }

      await app.db.delete(users).where(eq(users.id, id));

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "delete_user",
        target: id,
        meta: { docCount: docs.length },
      });

      return { deleted: true };
    },
  );
}
