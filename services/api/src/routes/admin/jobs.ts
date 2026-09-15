import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { adminAuditLog } from "@portfolio/db";
import {
  JOB_DESCRIPTORS,
  BACKFILL_STALE_QUEUE,
  BACKFILL_PORTFOLIO_QUEUE,
  getActiveBoss,
  triggerJob,
} from "../../services/scheduler.js";

export function registerJobsRoutes(app: FastifyInstance) {
  app.get("/admin/jobs", { preHandler: app.requireAdmin }, async () => {
    const boss = getActiveBoss();
    const schedulerAvailable = boss !== null;

    type JobRow = {
      name: string;
      lastRunAt: string | null;
      lastStatus: "completed" | "failed" | null;
      inProgress: number;
    };

    let liveRows: JobRow[] = [];
    // backfill-stale-history fans out onto backfill-portfolio (see #745); track that
    // queue's in-flight count too even though it's not itself a JOB_DESCRIPTOR (it isn't
    // directly user-triggerable) so the admin UI can show real fan-out progress instead
    // of the trigger silently looking "done" the moment the planner job completes.
    let fanOutRemaining = 0;
    if (schedulerAvailable) {
      try {
        const queueNames: string[] = [
          ...JOB_DESCRIPTORS.map((j) => j.name),
          BACKFILL_PORTFOLIO_QUEUE,
        ];
        // #748: for queues that only run on a cron schedule, exclude `created`-state
        // rows from the in-flight count. A cron queue with a 5-minute cadence almost
        // always has at least one `created` row sitting in the queue waiting for a
        // worker — counting those as "in flight" would misreport queue depth as
        // active work. For user-triggerable queues (`backfill-stale-history`) and
        // fan-out children (`backfill-portfolio`) we keep the full count so a
        // freshly-triggered job that hasn't started yet is still visible.
        // Base on all three states so the no-flags fallback is naturally correct
        // (count everything), then conditionally exclude cron-queue `created` rows.
        const cronOnlyActiveInFlightNames: string[] = JOB_DESCRIPTORS.filter(
          (j) => (j as { cronOnlyActiveInFlight?: boolean }).cronOnlyActiveInFlight === true,
        ).map((j) => j.name);
        // `NOT IN ()` is always true in Postgres, so an empty list correctly
        // results in no exclusion — all three states count for all queues.
        const excludeCreatedForCron =
          cronOnlyActiveInFlightNames.length > 0
            ? sql`AND NOT (state = 'created' AND name IN ${cronOnlyActiveInFlightNames})`
            : sql``;
        type JobStatusRow = {
          name: string;
          last_completed: string | null;
          last_failed: string | null;
          in_progress: number;
        };
        const rawResult = await app.db.execute<JobStatusRow>(sql`
          SELECT
            name,
            MAX(completed_on) FILTER (WHERE state = 'completed') AS last_completed,
            MAX(completed_on) FILTER (WHERE state = 'failed')    AS last_failed,
            COUNT(*) FILTER (
              WHERE state IN ('active', 'retry', 'created')
              ${excludeCreatedForCron}
            ) AS in_progress
          FROM pgboss.job
          WHERE name IN ${queueNames}
            AND (completed_on > NOW() - INTERVAL '30 days' OR completed_on IS NULL)
          GROUP BY name
        `);
        const rows: JobStatusRow[] = Array.isArray(rawResult)
          ? (rawResult as JobStatusRow[])
          : ((rawResult as unknown as { rows: JobStatusRow[] }).rows ?? []);
        liveRows = rows.map((r) => {
          const c = r.last_completed ? new Date(r.last_completed).toISOString() : null;
          const f = r.last_failed ? new Date(r.last_failed).toISOString() : null;
          const inProgress = Number(r.in_progress) || 0;
          if (!c && !f) return { name: r.name, lastRunAt: null, lastStatus: null, inProgress };
          const lastRunAt = c && f ? (c > f ? c : f) : (c ?? f);
          const lastStatus: "completed" | "failed" = c && (!f || c >= f) ? "completed" : "failed";
          return { name: r.name, lastRunAt, lastStatus, inProgress };
        });
        fanOutRemaining =
          liveRows.find((r) => r.name === BACKFILL_PORTFOLIO_QUEUE)?.inProgress ?? 0;
      } catch (err) {
        app.log.warn({ err }, "admin jobs status query failed");
      }
    }

    const liveMap = new Map(liveRows.map((r) => [r.name, r]));

    const jobs = JOB_DESCRIPTORS.map((d) => ({
      name: d.name,
      label: d.label,
      description: d.description,
      cron: d.cron,
      supportsForce: (d as { supportsForce?: boolean }).supportsForce ?? false,
      lastRunAt: liveMap.get(d.name)?.lastRunAt ?? null,
      lastStatus: liveMap.get(d.name)?.lastStatus ?? null,
      inProgress: liveMap.get(d.name)?.inProgress ?? 0,
      ...(d.name === BACKFILL_STALE_QUEUE ? { fanOutRemaining } : {}),
    }));

    return { schedulerAvailable, jobs };
  });

  app.post(
    "/admin/jobs/:name/trigger",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const { name } = request.params as { name: string };
      const knownNames = new Set<string>(JOB_DESCRIPTORS.map((j) => j.name));
      if (!knownNames.has(name)) {
        return reply.code(404).send({ error: "unknown_job" });
      }

      const query = request.query as Record<string, string> | null;
      const body = request.body as Record<string, unknown> | null;
      const force = Boolean(query?.force === "1" || query?.force === "true" || body?.force);
      // Optional scope for force mode (currently only meaningful to backfill-stale-history,
      // see #745) — a full re-backfill of every user's every portfolio is what exceeded
      // pg-boss's handler timeout at platform scale; scoping to one user is the cheap
      // escape hatch for "I just need to re-check my own data" without touching everyone.
      const userId =
        typeof query?.userId === "string"
          ? query.userId
          : typeof body?.userId === "string"
            ? body.userId
            : undefined;
      const payload: Record<string, unknown> = {
        ...(force ? { force: true } : {}),
        ...(userId ? { userId } : {}),
      };

      const result = await triggerJob(name, payload);
      if (!result.queued) {
        if (result.alreadyInFlight) {
          return reply.code(409).send({ error: "already_in_flight" });
        }
        return reply.code(503).send({ error: "scheduler_unavailable" });
      }

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "trigger_job",
        target: name,
        meta: Object.keys(payload).length > 0 ? payload : null,
      });

      return { queued: true, name, ...payload };
    },
  );
}
