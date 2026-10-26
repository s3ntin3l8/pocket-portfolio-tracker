import type { FastifyInstance } from "fastify";
import { checkIntegrity, collectBodies, RULES } from "../services/integrity/index.js";

/**
 * `GET /me/integrity` — runs the cross-endpoint invariants (`services/integrity`) over the
 * caller's own data and returns the findings. Read-only: it only issues GETs, in-process, with
 * the caller's own credential, so it sees exactly what that credential sees (a read-scoped PAT
 * gets cached-only FX, like every other read). A finding names a rule, its scope, and expected
 * vs. actual — evidence for "this looks wrong", not a verdict on which side is wrong.
 *
 * Findings carry amounts: they go to the authenticated caller only and are never logged.
 */
export async function integrityRoute(app: FastifyInstance) {
  app.get("/me/integrity", { preHandler: app.authenticate }, async (request, reply) => {
    // `app.authenticate` has already rejected anything without a Bearer credential.
    const authorization = request.headers.authorization as string;

    const get = async (url: string): Promise<unknown> => {
      const res = await app.inject({ method: "GET", url, headers: { authorization } });
      if (res.statusCode !== 200) throw new Error(`${url} -> ${res.statusCode}`);
      return res.json();
    };

    let bodies;
    try {
      bodies = await collectBodies(get);
    } catch (err) {
      request.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "integrity collect failed",
      );
      return reply.code(502).send({
        error: "integrity_collect_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      checkedAt: new Date().toISOString(),
      portfolioCount: bodies.portfolios.length,
      rulesRun: Object.keys(RULES),
      findings: checkIntegrity(bodies),
    };
  });
}
