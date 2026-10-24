import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { transactions, dismissedAnomalies, trConnections, ibkrConnections } from "@portfolio/db";
import { toCoreTxns } from "../../services/tx-core.js";
import { netManualAdjustments } from "../../services/pytr/reconcile.js";
import { loadSparklines } from "../../services/sparklines.js";
import { needsSectorEnrichment, needsNameEnrichment } from "../../services/instrument-metadata.js";
import { isReadOnlyPat } from "../../plugins/auth.js";
import { enqueueInstrumentMetadata } from "../../services/scheduler.js";
import {
  computeHoldings,
  detectAnomalies,
  allocationBreakdown,
  type CoreTransaction,
  type ReconciliationGap,
} from "@portfolio/core";

import type { PortfolioParams } from "./shared.js";
import {
  corporateActionsFor,
  loadValuation,
  loadDrift,
  computePortfolioAnomalies,
  buildGainSummary,
  resolveCostBasisMode,
} from "./shared.js";

export function registerHoldingsRoutes(app: FastifyInstance) {
  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/holdings",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      const { portfolioId } = request.params;
      const portfolio = request.portfolio;
      const [rows, trConn, ibkrConn, dismissed] = await Promise.all([
        app.db.select().from(transactions).where(eq(transactions.portfolioId, portfolioId)),
        app.db
          .select({ lastReconciliation: trConnections.lastReconciliation })
          .from(trConnections)
          .where(eq(trConnections.portfolioId, portfolioId))
          .limit(1)
          .then((r) => r[0] ?? null),
        // IBKR reports its own reconciliation gap in the same shape as TR — reading only
        // the TR connection left the reconciliation anomalies blind to IBKR portfolios.
        app.db
          .select({ lastReconciliation: ibkrConnections.lastReconciliation })
          .from(ibkrConnections)
          .where(eq(ibkrConnections.portfolioId, portfolioId))
          .limit(1)
          .then((r) => r[0] ?? null),
        app.db
          .select({
            transactionId: dismissedAnomalies.transactionId,
            code: dismissedAnomalies.code,
          })
          .from(dismissedAnomalies)
          .where(eq(dismissedAnomalies.portfolioId, portfolioId)),
      ]);
      const coreTxns: CoreTransaction[] = toCoreTxns(rows);
      const cas = await corporateActionsFor(
        app,
        rows.map((r) => r.instrumentId),
        portfolioId,
      );
      const holdings = computeHoldings(coreTxns, cas);
      const rawReconciliation = trConn?.lastReconciliation as ReconciliationGap | null | undefined;
      const reconciliation = rawReconciliation
        ? netManualAdjustments(rawReconciliation, coreTxns)
        : rawReconciliation;
      const rawIbkrReconciliation = ibkrConn?.lastReconciliation as
        ReconciliationGap | null | undefined;
      const ibkrReconciliation = rawIbkrReconciliation
        ? netManualAdjustments(rawIbkrReconciliation, coreTxns)
        : rawIbkrReconciliation;
      // One gap per connected broker — a portfolio can have both.
      const reconciliationGaps: ReconciliationGap[] = [];
      if (reconciliation) reconciliationGaps.push({ ...reconciliation, broker: "tr" });
      if (ibkrReconciliation) reconciliationGaps.push({ ...ibkrReconciliation, broker: "ibkr" });
      const anomalies = detectAnomalies(coreTxns, cas, {
        cashCounted: portfolio.cashCounted,
        allowNegativeCash: portfolio.allowNegativeCash,
        reconciliationGap: reconciliationGaps.length > 0 ? reconciliationGaps : null,
      });
      const dismissedSet = new Set(dismissed.map((d) => `${d.transactionId}:${d.code}`));
      const filtered = anomalies.filter(
        (a) => !(a.transactionId && dismissedSet.has(`${a.transactionId}:${a.code}`)),
      );
      request.timingName = "GET /portfolios/:id/holdings";
      request.timingMeta = {
        portfolioId,
        holdingCount: holdings.length,
        anomalyCount: filtered.length,
      };
      return { holdings, anomalies: filtered };
    },
  );

  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/anomalies",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      const { portfolioId } = request.params;
      const portfolio = request.portfolio;
      const filtered = await computePortfolioAnomalies(app, portfolio);
      request.timingName = "GET /portfolios/:id/anomalies";
      request.timingMeta = { portfolioId, anomalyCount: filtered.length };
      return { anomalies: filtered };
    },
  );

  app.get<{ Params: PortfolioParams; Querystring: { costBasis?: string } }>(
    "/portfolios/:portfolioId/summary",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const portfolio = request.portfolio;
      const { summary, metaById, coreTxns, corporateActions } = await loadValuation(
        app,
        portfolioId,
        portfolio.baseCurrency,
        await resolveCostBasisMode(app, id, request.query),
        portfolio.cashCounted,
        request.log,
      );
      if (
        !isReadOnlyPat(request) &&
        (needsSectorEnrichment([...metaById.values()]) ||
          needsNameEnrichment([...metaById.values()]))
      ) {
        void enqueueInstrumentMetadata();
      }
      const allocation = allocationBreakdown(summary, metaById);
      const drift = await loadDrift(app, id, portfolioId, allocation);
      const spark = await loadSparklines(
        app.db,
        summary.holdings.map((h) => h.instrumentId),
      );
      request.timingName = "GET /portfolios/:id/summary";
      request.timingMeta = { portfolioId, holdingCount: summary.holdings.length };
      return {
        ...summary,
        holdings: summary.holdings.map((h) => ({
          ...h,
          instrument: metaById.get(h.instrumentId) ?? null,
          sparkline: spark.get(h.instrumentId),
        })),
        allocation,
        ...(Object.keys(drift).length > 0 ? { drift } : {}),
        gain: await buildGainSummary(
          app,
          coreTxns,
          summary,
          portfolio.baseCurrency,
          portfolio.cashCounted ? "inside" : "outside",
          corporateActions,
        ),
      };
    },
  );
}
