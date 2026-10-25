import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

export async function healthRoute(app: FastifyInstance) {
  // Liveness: the process is up and serving. The `service` field is this API's identity:
  // a client that cannot reach its data can compare it to tell "our API answered" from
  // "some other server answered on the same port" (the web app's diagnostic — a squatter
  // bound to 127.0.0.1:3000 shadows an API bound to *:3000).
  app.get("/health", async () => {
    return { status: "healthy", service: "pocket-api" };
  });

  // Readiness: dependencies (the database) are reachable.
  app.get("/ready", async (_request, reply) => {
    try {
      await app.db.execute(sql`SELECT 1`);
      return { status: "ready" };
    } catch (err) {
      app.log.error(err);
      reply.code(503);
      return { status: "unavailable" };
    }
  });
}
