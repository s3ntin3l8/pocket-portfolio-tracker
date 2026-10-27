import type { FastifyInstance } from "fastify";
import { adminAuditLog } from "@portfolio/db";
import { BACKFILL_STALE_QUEUE, triggerJob } from "../services/scheduler.js";
import { createWindowLimiter } from "../lib/window-limiter.js";
import { requireUser } from "../plugins/auth.js";

/**
 * `POST /me/jobs/backfill` — re-run the price-history backfill for the caller's own portfolios.
 * The admin trigger needs the admin group, which no PAT ever has; this is the same job scoped to
 * `request.user`, so there is nothing to escalate. `userId` is never read from the request, and a
 * read-scoped PAT / connector token is refused by the mutating-method gate in `plugins/auth.ts`
 * (do not mark this route `scope: "read"`).
 */
export async function meJobsRoute(app: FastifyInstance) {
  // A forced backfill refetches every held instrument: a few per hour is plenty.
  const limiter = createWindowLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

  app.post("/me/jobs/backfill", { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    const body = request.body as Record<string, unknown> | null;
    // Opt back in to feeds cooling down as dead (delisted symbols); see the dead-feed guard.
    const retryDeadFeeds = body?.retryDeadFeeds === true;

    // Only a request that actually queues costs a slot: a 409/503 enqueued nothing.
    const allowed = limiter.check(user.id);
    if (!allowed.ok) {
      return reply
        .code(429)
        .header("retry-after", String(allowed.retryAfterSec))
        .send({ error: "backfill_rate_limited" });
    }

    const payload: Record<string, unknown> = {
      force: true,
      ...(retryDeadFeeds ? { retryDeadFeeds: true } : {}),
      userId: user.id,
    };
    const result = await triggerJob(BACKFILL_STALE_QUEUE, payload);
    if (!result.queued) {
      if (result.alreadyInFlight) return reply.code(409).send({ error: "already_in_flight" });
      return reply.code(503).send({ error: "scheduler_unavailable" });
    }

    limiter.hit(user.id);

    await app.db.insert(adminAuditLog).values({
      actorSub: user.authSub,
      action: "user_trigger_backfill",
      target: BACKFILL_STALE_QUEUE,
      meta: payload,
    });
    return { queued: true, retryDeadFeeds };
  });
}
