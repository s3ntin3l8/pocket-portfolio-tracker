import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { allocationTargets, portfolios, users } from "@portfolio/db";
import { allocationTargetSetSchema } from "@portfolio/schema";
import {
  aggregatePortfolios,
  allocationBreakdown,
  rebalancingDrift,
  rebalancingTrades,
  type PortfolioSummary,
  type TargetWeight,
} from "@portfolio/core";
import { mapPool } from "../lib/promise-pool.js";
import {
  instrumentMeta,
  loadValuation,
  resolveCostBasisMode,
  PORTFOLIO_VALUATION_CONCURRENCY,
} from "./transactions/shared.js";

/**
 * Allocation target routes.
 *
 * Targets are stored in `allocation_targets` with a nullable `portfolioId`:
 *   - null   = aggregate / networth-level targets
 *   - non-null = per-portfolio targets (Sparplan instrument split, etc.)
 *
 * All PUT operations are atomic replace-whole-set (delete existing then insert new),
 * scoped to (userId, portfolioId, dimension). The sum-to-100 validation is enforced
 * at the Zod layer via `allocationTargetSetSchema`.
 *
 * Routes registered:
 *   GET  /networth/targets?dimension=
 *   PUT  /networth/targets
 *   GET  /portfolios/:portfolioId/targets?dimension=
 *   PUT  /portfolios/:portfolioId/targets
 *   GET  /networth/rebalancing?dimension=&newCash=
 *   GET  /portfolios/:portfolioId/rebalancing?dimension=&newCash=
 */
const REBALANCING_DIMENSIONS = ["asset_class", "currency", "region", "sector"] as const;
type RebalancingDimension = (typeof REBALANCING_DIMENSIONS)[number];

/** A positive decimal string: digits with an optional fraction, no sign, exponent or leading zeros. */
function parseNewCash(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 24 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(v)) return null;
  return new Decimal(v).gt(0) ? v : null;
}

export async function targetsRoute(app: FastifyInstance) {
  /** Map DB rows to the API response shape. */
  function toTargetWeights(rows: (typeof allocationTargets.$inferSelect)[]) {
    return rows.map((r) => ({
      key: r.targetKey,
      targetPct: Number(r.targetPct),
    }));
  }

  // ---------------------------------------------------------------------------
  // Aggregate (networth-level) targets — portfolioId = null
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: { dimension?: string } }>(
    "/networth/targets",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const dimension = request.query.dimension;
      if (!dimension) {
        return reply.code(400).send({ error: "dimension_required" });
      }
      const rows = await app.db
        .select()
        .from(allocationTargets)
        .where(
          and(
            eq(allocationTargets.userId, id),
            isNull(allocationTargets.portfolioId),
            eq(allocationTargets.dimension, dimension),
          ),
        );
      return toTargetWeights(rows);
    },
  );

  app.put("/networth/targets", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;
    const parsed = allocationTargetSetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues });
    }
    const { dimension, targets } = parsed.data;

    await app.db.transaction(async (tx) => {
      // Delete existing targets for this (user, null-portfolio, dimension).
      await tx
        .delete(allocationTargets)
        .where(
          and(
            eq(allocationTargets.userId, id),
            isNull(allocationTargets.portfolioId),
            eq(allocationTargets.dimension, dimension),
          ),
        );
      if (targets.length > 0) {
        await tx.insert(allocationTargets).values(
          targets.map((t) => ({
            userId: id,
            portfolioId: null,
            dimension,
            targetKey: t.key,
            targetPct: String(t.targetPct),
          })),
        );
      }
    });

    // Return the newly saved set.
    const rows = await app.db
      .select()
      .from(allocationTargets)
      .where(
        and(
          eq(allocationTargets.userId, id),
          isNull(allocationTargets.portfolioId),
          eq(allocationTargets.dimension, dimension),
        ),
      );
    return toTargetWeights(rows);
  });

  // ---------------------------------------------------------------------------
  // Per-portfolio targets
  // ---------------------------------------------------------------------------

  app.get<{ Params: { portfolioId: string }; Querystring: { dimension?: string } }>(
    "/portfolios/:portfolioId/targets",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const dimension = request.query.dimension;
      if (!dimension) {
        return reply.code(400).send({ error: "dimension_required" });
      }
      const rows = await app.db
        .select()
        .from(allocationTargets)
        .where(
          and(
            eq(allocationTargets.userId, id),
            eq(allocationTargets.portfolioId, portfolioId),
            eq(allocationTargets.dimension, dimension),
          ),
        );
      return toTargetWeights(rows);
    },
  );

  app.put<{ Params: { portfolioId: string } }>(
    "/portfolios/:portfolioId/targets",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const parsed = allocationTargetSetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues });
      }
      const { dimension, targets } = parsed.data;

      await app.db.transaction(async (tx) => {
        await tx
          .delete(allocationTargets)
          .where(
            and(
              eq(allocationTargets.userId, id),
              eq(allocationTargets.portfolioId, portfolioId),
              eq(allocationTargets.dimension, dimension),
            ),
          );
        if (targets.length > 0) {
          await tx.insert(allocationTargets).values(
            targets.map((t) => ({
              userId: id,
              portfolioId,
              dimension,
              targetKey: t.key,
              targetPct: String(t.targetPct),
            })),
          );
        }
      });

      const rows = await app.db
        .select()
        .from(allocationTargets)
        .where(
          and(
            eq(allocationTargets.userId, id),
            eq(allocationTargets.portfolioId, portfolioId),
            eq(allocationTargets.dimension, dimension),
          ),
        );
      return toTargetWeights(rows);
    },
  );

  /**
   * Targets + drift + the buy-only new-cash split for one dimension, from the SAME summary and
   * allocation the summary routes derive drift from. Core does the maths; amounts are decimal
   * strings in the display currency. Missing FX is reported by the global fx-missing hook.
   */
  function rebalancingPlan(
    dimension: RebalancingDimension,
    newCash: string,
    summary: PortfolioSummary,
    meta: Parameters<typeof allocationBreakdown>[1],
    rows: (typeof allocationTargets.$inferSelect)[],
  ) {
    const allocation = allocationBreakdown(summary, meta);
    const slices = {
      asset_class: allocation.byAssetClass,
      currency: allocation.byCurrency,
      region: allocation.byRegion,
      sector: allocation.bySector,
    }[dimension];
    const targets: TargetWeight[] = rows.map((r) => ({
      key: r.targetKey,
      targetPct: Number(r.targetPct),
    }));
    const drift = rebalancingDrift(slices, targets);
    const total = slices.reduce((acc, s) => acc.add(s.value), new Decimal(0)).toString();
    return {
      dimension,
      displayCurrency: summary.displayCurrency,
      newCash,
      targets,
      drift,
      trades: rebalancingTrades(drift, total, { mode: "newCash", newCash }),
    };
  }

  function parseRebalancingQuery(q: { dimension?: string; newCash?: string }) {
    const dimension = REBALANCING_DIMENSIONS.find((d) => d === q.dimension);
    if (!dimension) return { error: "invalid_dimension" as const };
    const newCash = parseNewCash(q.newCash);
    if (!newCash) return { error: "invalid_new_cash" as const };
    return { dimension, newCash };
  }

  app.get<{ Querystring: { dimension?: string; newCash?: string; costBasis?: string } }>(
    "/networth/rebalancing",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const q = parseRebalancingQuery(request.query);
      if ("error" in q) return reply.code(400).send({ error: q.error });
      const [u] = await app.db
        .select({ displayCurrency: users.displayCurrency })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const display = u?.displayCurrency ?? "IDR";
      const costBasisMode = await resolveCostBasisMode(app, id, request.query);
      const pfs = await app.db.select().from(portfolios).where(eq(portfolios.userId, id));
      const summaries = await mapPool(pfs, PORTFOLIO_VALUATION_CONCURRENCY, async (p) => {
        const { summary } = await loadValuation(app, p.id, display, costBasisMode, p.cashCounted);
        return summary;
      });
      const aggregated = aggregatePortfolios(summaries, display);
      const meta = await instrumentMeta(app, [
        ...new Set(aggregated.holdings.map((h) => h.instrumentId)),
      ]);
      const rows = await app.db
        .select()
        .from(allocationTargets)
        .where(
          and(
            eq(allocationTargets.userId, id),
            isNull(allocationTargets.portfolioId),
            eq(allocationTargets.dimension, q.dimension),
          ),
        );
      return rebalancingPlan(q.dimension, q.newCash, aggregated, meta, rows);
    },
  );

  app.get<{
    Params: { portfolioId: string };
    Querystring: { dimension?: string; newCash?: string; costBasis?: string };
  }>(
    "/portfolios/:portfolioId/rebalancing",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const q = parseRebalancingQuery(request.query);
      if ("error" in q) return reply.code(400).send({ error: q.error });
      const portfolio = request.portfolio;
      const { summary, metaById } = await loadValuation(
        app,
        portfolioId,
        portfolio.baseCurrency,
        await resolveCostBasisMode(app, id, request.query),
        portfolio.cashCounted,
        request.log,
      );
      const rows = await app.db
        .select()
        .from(allocationTargets)
        .where(
          and(
            eq(allocationTargets.userId, id),
            eq(allocationTargets.portfolioId, portfolioId),
            eq(allocationTargets.dimension, q.dimension),
          ),
        );
      return rebalancingPlan(q.dimension, q.newCash, summary, metaById, rows);
    },
  );
}
