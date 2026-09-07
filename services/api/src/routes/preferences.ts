import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { userBenchmarkSymbols, userPreferences } from "@portfolio/db";
import { benchmarkLabel, userPreferencesSchema } from "@portfolio/schema";

/**
 * PATCH-style body validation for benchmarkSymbols: schema-level checks
 * (length 1..3, unique symbols) are enforced by `benchmarkSymbolsSchema`,
 * but the route layer also requires *all* symbols to be non-empty strings
 * and re-derives `displayName` server-side when the client omits it.
 */
function dedupeAndLabel(
  entries: { symbol: string; displayName?: string }[],
): { symbol: string; displayName: string }[] {
  const seen = new Set<string>();
  const out: { symbol: string; displayName: string }[] = [];
  for (const e of entries) {
    const symbol = e.symbol.trim();
    if (!symbol) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, displayName: e.displayName?.trim() || benchmarkLabel(symbol) });
  }
  return out;
}

export async function preferencesRoute(app: FastifyInstance) {
  app.get("/me/preferences", { preHandler: app.authenticate }, async (request) => {
    const id = request.userId;
    const [prefs] = await app.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, id))
      .limit(1);
    const symbols = await app.db
      .select({
        symbol: userBenchmarkSymbols.symbol,
        displayName: userBenchmarkSymbols.displayName,
        displayOrder: userBenchmarkSymbols.displayOrder,
      })
      .from(userBenchmarkSymbols)
      .where(eq(userBenchmarkSymbols.userId, id))
      .orderBy(asc(userBenchmarkSymbols.displayOrder));
    request.timingName = "GET /me/preferences";
    request.timingMeta = {};
    return {
      dashboardPeriod: prefs?.dashboardPeriod ?? "max",
      dashboardKpis: prefs?.dashboardKpis ?? null,
      costBasisMode: prefs?.costBasisMode ?? "purchase_price",
      taxRegime: prefs?.taxRegime ?? "DE",
      benchmarkSymbols:
        symbols.length > 0
          ? symbols.map((s) => ({
              symbol: s.symbol,
              displayName: s.displayName,
              displayOrder: s.displayOrder,
            }))
          : [{ symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 }],
      riskFreeRate: prefs?.riskFreeRate ? Number(prefs.riskFreeRate) : null,
      retirementAge: prefs?.retirementAge ?? null,
    };
  });

  app.put("/me/preferences", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;
    const body = userPreferencesSchema.parse(request.body);
    const now = new Date();

    if (body.benchmarkSymbols) {
      const unique = dedupeAndLabel(body.benchmarkSymbols);
      if (unique.length === 0) {
        return reply.code(400).send({ error: "at least one benchmark is required" });
      }
      if (unique.length > 3) {
        return reply.code(400).send({ error: "at most 3 benchmarks" });
      }
      const seenDup = new Set<string>();
      for (const e of body.benchmarkSymbols) {
        const s = e.symbol.trim();
        if (seenDup.has(s)) {
          return reply.code(400).send({ error: `duplicate benchmark symbol: ${s}` });
        }
        seenDup.add(s);
      }
    }

    // Upsert the user_preferences row (without benchmark_symbol — that column
    // is gone in this PR). benchmarkSymbols live in their own table; we replace
    // the user's set atomically inside the same call.
    const [updated] = await app.db
      .insert(userPreferences)
      .values({
        userId: id,
        dashboardPeriod: body.dashboardPeriod ?? "max",
        dashboardKpis: body.dashboardKpis ?? null,
        costBasisMode: body.costBasisMode ?? "purchase_price",
        taxRegime: body.taxRegime ?? "DE",
        riskFreeRate: body.riskFreeRate != null ? String(body.riskFreeRate) : null,
        retirementAge: body.retirementAge ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          ...(body.dashboardPeriod !== undefined ? { dashboardPeriod: body.dashboardPeriod } : {}),
          ...(body.dashboardKpis !== undefined ? { dashboardKpis: body.dashboardKpis } : {}),
          ...(body.costBasisMode !== undefined ? { costBasisMode: body.costBasisMode } : {}),
          ...(body.taxRegime !== undefined ? { taxRegime: body.taxRegime } : {}),
          ...(body.riskFreeRate !== undefined
            ? { riskFreeRate: body.riskFreeRate != null ? String(body.riskFreeRate) : null }
            : {}),
          ...(body.retirementAge !== undefined ? { retirementAge: body.retirementAge } : {}),
          updatedAt: now,
        },
      })
      .returning();

    if (body.benchmarkSymbols) {
      const unique = dedupeAndLabel(body.benchmarkSymbols);
      await app.db.transaction(async (tx) => {
        await tx.delete(userBenchmarkSymbols).where(eq(userBenchmarkSymbols.userId, id));
        if (unique.length > 0) {
          await tx.insert(userBenchmarkSymbols).values(
            unique.map((e, i) => ({
              userId: id,
              symbol: e.symbol,
              displayName: e.displayName,
              displayOrder: i,
            })),
          );
        }
      });
    }

    const finalSymbols = await app.db
      .select({
        symbol: userBenchmarkSymbols.symbol,
        displayName: userBenchmarkSymbols.displayName,
        displayOrder: userBenchmarkSymbols.displayOrder,
      })
      .from(userBenchmarkSymbols)
      .where(eq(userBenchmarkSymbols.userId, id))
      .orderBy(asc(userBenchmarkSymbols.displayOrder));

    request.timingName = "PUT /me/preferences";
    request.timingMeta = {};

    return {
      dashboardPeriod: updated?.dashboardPeriod ?? "max",
      dashboardKpis: updated?.dashboardKpis ?? null,
      costBasisMode: updated?.costBasisMode ?? "purchase_price",
      taxRegime: updated?.taxRegime ?? "DE",
      benchmarkSymbols: finalSymbols,
      riskFreeRate: updated?.riskFreeRate ? Number(updated.riskFreeRate) : null,
      retirementAge: updated?.retirementAge ?? null,
    };
  });
}
