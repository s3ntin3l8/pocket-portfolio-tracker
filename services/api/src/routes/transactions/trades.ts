import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { accountHolders, portfolios, users } from "@portfolio/db";
import { type InstrumentMeta } from "../../services/valuation.js";
import { type TradeLog, mergeTradeLogs } from "@portfolio/core";
import { withDerivationCache } from "../../lib/derivation-cache.js";
import { mapPool } from "../../lib/promise-pool.js";
import {
  collectVorabNeeds,
  estimateVorabFromPrices,
  loadEstimatedVorabRows,
  loadVorabPrices,
} from "../../services/vorab-estimate.js";
import { cacheKey } from "../helpers.js";
import type { PortfolioParams } from "./shared.js";
import {
  resolveCostBasisMode,
  resolveTaxRegime,
  methodFromQuery,
  buildTradeLog,
  attachInstruments,
  tradesCache,
  networthTradesCache,
  loadValuation,
  PORTFOLIO_VALUATION_CONCURRENCY,
} from "./shared.js";

export function registerTradesRoutes(app: FastifyInstance) {
  app.get<{ Params: PortfolioParams; Querystring: { method?: string; costBasis?: string } }>(
    "/portfolios/:portfolioId/trades",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      const { portfolioId } = request.params;
      const portfolio = request.portfolio;
      const method = methodFromQuery(request.query);
      const costBasisMode = await resolveCostBasisMode(app, request.userId, request.query);
      // Estimated Vorabpauschale rows are DE-only, so the regime is part of the cache key.
      const regime = await resolveTaxRegime(app, request.userId);
      const cached = await withDerivationCache(
        tradesCache,
        cacheKey(portfolioId, method, costBasisMode, regime),
        async () => {
          const {
            coreTxns,
            prices,
            metaById,
            corporateActions: cas,
          } = await loadValuation(
            app,
            portfolioId,
            portfolio.baseCurrency,
            costBasisMode,
            portfolio.cashCounted,
          );
          const estimated =
            regime === "DE"
              ? await loadEstimatedVorabRows(app.db, coreTxns, cas, metaById, new Date(), app.log)
              : [];
          const log = await buildTradeLog(
            app,
            estimated.length > 0 ? [...coreTxns, ...estimated] : coreTxns,
            prices,
            portfolio.baseCurrency,
            method,
            costBasisMode,
            metaById,
          );
          return attachInstruments(log, metaById);
        },
      );
      request.timingName = "GET /portfolios/:id/trades";
      request.timingMeta = {
        portfolioId,
        method,
        costBasis: costBasisMode,
      };
      return cached;
    },
  );

  app.get<{ Querystring: { method?: string; costBasis?: string; holderId?: string } }>(
    "/networth/trades",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const { holderId } = request.query;
      const method = methodFromQuery(request.query);
      const costBasisMode = await resolveCostBasisMode(app, request.userId, request.query);
      const regime = await resolveTaxRegime(app, id);

      if (holderId != null) {
        const [holder] = await app.db
          .select()
          .from(accountHolders)
          .where(and(eq(accountHolders.id, holderId), eq(accountHolders.userId, id)))
          .limit(1);
        if (!holder) return reply.status(404).send({ error: "holder_not_found" });
      }

      const pfs = await app.db
        .select({ id: portfolios.id, cashCounted: portfolios.cashCounted })
        .from(portfolios)
        .where(
          holderId != null
            ? and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holderId))
            : eq(portfolios.userId, id),
        );

      const result = await withDerivationCache(
        networthTradesCache,
        cacheKey(id, method, costBasisMode, holderId ?? "", regime),
        async () => {
          const [u] = await app.db
            .select({ displayCurrency: users.displayCurrency })
            .from(users)
            .where(eq(users.id, id))
            .limit(1);
          const display = u?.displayCurrency ?? "IDR";

          // Phase 1: valuations; phase 2: one shared boundary-price query (DE only);
          // phase 3: per-portfolio trade logs with the estimates.
          const loaded = await mapPool(pfs, PORTFOLIO_VALUATION_CONCURRENCY, (p) =>
            loadValuation(app, p.id, display, costBasisMode, p.cashCounted),
          );
          const now = new Date();
          const vorabPriceOn =
            regime === "DE"
              ? await loadVorabPrices(
                  app.db,
                  loaded.map((v) => collectVorabNeeds(v.coreTxns, v.metaById)),
                  now,
                )
              : null;
          const perPortfolio = await mapPool(loaded, PORTFOLIO_VALUATION_CONCURRENCY, async (v) => {
            const { coreTxns, prices, metaById, corporateActions: cas } = v;
            const estimated = vorabPriceOn
              ? estimateVorabFromPrices(coreTxns, cas, metaById, vorabPriceOn, now, app.log)
              : [];
            const log = await buildTradeLog(
              app,
              estimated.length > 0 ? [...coreTxns, ...estimated] : coreTxns,
              prices,
              display,
              method,
              costBasisMode,
              metaById,
            );
            return { log, metaById };
          });
          const logs: TradeLog[] = perPortfolio.map((r) => r.log);
          const meta = new Map<string, InstrumentMeta>();
          for (const { metaById } of perPortfolio) {
            for (const [k, v] of metaById) meta.set(k, v);
          }
          return attachInstruments(mergeTradeLogs(logs, display, method), meta);
        },
      );
      request.timingName = "GET /networth/trades";
      request.timingMeta = { portfolioCount: pfs.length };
      return result;
    },
  );
}
