import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { pushSubscriptions } from "@portfolio/db";
import { requireUser } from "../plugins/auth.js";
import { createWindowLimiter } from "../lib/window-limiter.js";
import { isAllowedPushEndpoint, notifyUser, pushEnabled } from "../services/notifications/push.js";

// More than a handful of devices per person is a leak, not a use case.
const MAX_SUBSCRIPTIONS_PER_USER = 10;

const subscribeSchema = z.object({
  endpoint: z.string().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});

/**
 * Web Push device registration for the installed PWA. Mutating routes are write-scoped by the
 * generic gate in `plugins/auth.ts` (a read-scoped PAT / connector token cannot subscribe).
 */
export async function pushRoute(app: FastifyInstance) {
  // "Send test" costs a push per device; a few per hour is plenty.
  const testLimiter = createWindowLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

  app.get("/me/push/config", { preHandler: app.authenticate }, async () => {
    const enabled = pushEnabled(app.config) && app.encryption.isEnabled;
    return { enabled, publicKey: enabled ? app.config.VAPID_PUBLIC_KEY : null };
  });

  app.post("/me/push/subscriptions", { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    if (!pushEnabled(app.config)) return reply.code(503).send({ error: "push_not_configured" });
    if (!app.encryption.isEnabled) return reply.code(503).send({ error: "encryption_required" });

    const parsed = subscribeSchema.safeParse(request.body);
    if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint)) {
      return reply.code(400).send({ error: "invalid_subscription" });
    }
    const { endpoint, keys } = parsed.data;
    const row = {
      userId: user.id,
      endpoint,
      p256dhEnc: app.encryption.encryptString(keys.p256dh),
      authEnc: app.encryption.encryptString(keys.auth),
      userAgent: (request.headers["user-agent"] ?? "").slice(0, 256) || null,
    };
    // The endpoint identifies a browser profile: if someone else signed in on it before, the
    // subscription moves to the current user rather than notifying the previous one.
    await app.db
      .insert(pushSubscriptions)
      .values(row)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row });

    const mine = await app.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id))
      .orderBy(asc(pushSubscriptions.createdAt));
    for (const stale of mine.slice(0, Math.max(0, mine.length - MAX_SUBSCRIPTIONS_PER_USER))) {
      await app.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, stale.id));
    }
    return reply.code(201).send({ ok: true });
  });

  app.delete("/me/push/subscriptions", { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const { endpoint } = z.object({ endpoint: z.string().max(2048) }).parse(request.query);
    await app.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
    return reply.code(204).send();
  });

  app.post("/me/push/test", { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    if (!pushEnabled(app.config)) return reply.code(503).send({ error: "push_not_configured" });

    const [any] = await app.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id))
      .limit(1);
    if (!any) return reply.code(409).send({ error: "no_subscriptions" });

    // `hit()` alone decides, so two concurrent requests cannot both slip past a `check()`.
    const allowed = testLimiter.hit(user.id);
    if (!allowed.ok) {
      return reply
        .code(429)
        .header("retry-after", String(allowed.retryAfterSec))
        .send({ error: "push_test_rate_limited" });
    }
    const result = await notifyUser(
      {
        db: app.db,
        encryption: app.encryption,
        config: app.config,
        log: request.log,
        sender: app.pushSender,
      },
      user.id,
      { title: "Pocket", body: "Notifications are on for this device.", url: "/", tag: "test" },
    );
    return { sent: result.sent };
  });
}
