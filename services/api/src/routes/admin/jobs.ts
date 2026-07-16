import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { adminAuditLog } from "@portfolio/db";
import { JOB_DESCRIPTORS, getActiveBoss, triggerJob } from "../../services/scheduler.js";

export function registerJobsRoutes(app: FastifyInstance) {
  app.get("/admin/jobs", { preHandler: app.requireAdmin }, async () => {
    const boss = getActiveBoss();
    const schedulerAvailable = boss !== null;

    type JobRow = {
      name: string;
      lastRunAt: string | null;
      lastStatus: "completed" | "failed" | null;
    };

    let liveRows: JobRow[] = [];
    if (schedulerAvailable) {
      try {
        const queueNames: string[] = JOB_DESCRIPTORS.map((j) => j.name);
        type JobStatusRow = {
          name: string;
          last_completed: string | null;
          last_failed: string | null;
        };
        const rawResult = await app.db.execute<JobStatusRow>(sql`
          SELECT
            name,
            MAX(completed_on) FILTER (WHERE state = 'completed') AS last_completed,
            MAX(completed_on) FILTER (WHERE state = 'failed')    AS last_failed
          FROM pgboss.job
          WHERE name IN ${queueNames}
            AND completed_on > NOW() - INTERVAL '30 days'
          GROUP BY name
        `);
        const rows: JobStatusRow[] = Array.isArray(rawResult)
          ? (rawResult as JobStatusRow[])
          : ((rawResult as unknown as { rows: JobStatusRow[] }).rows ?? []);
        liveRows = rows.map((r) => {
          const c = r.last_completed ? new Date(r.last_completed).toISOString() : null;
          const f = r.last_failed ? new Date(r.last_failed).toISOString() : null;
          if (!c && !f) return { name: r.name, lastRunAt: null, lastStatus: null };
          const lastRunAt = c && f ? (c > f ? c : f) : (c ?? f);
          const lastStatus: "completed" | "failed" = c && (!f || c >= f) ? "completed" : "failed";
          return { name: r.name, lastRunAt, lastStatus };
        });
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

      const queryForce = (request.query as Record<string, string> | null)?.force;
      const bodyForce = (request.body as Record<string, unknown> | null)?.force;
      const force = Boolean(queryForce === "1" || queryForce === "true" || bodyForce);
      const payload: Record<string, unknown> = force ? { force: true } : {};

      const result = await triggerJob(name, payload);
      if (!result.queued) {
        return reply.code(503).send({ error: "scheduler_unavailable" });
      }

      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "trigger_job",
        target: name,
        meta: force ? { force: true } : null,
      });

      return { queued: true, name, ...(force ? { force: true } : {}) };
    },
  );
}
