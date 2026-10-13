import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte } from "drizzle-orm";
import { accountHolders, portfolioSnapshots, portfolios, users } from "@portfolio/db";
import {
  aggregatePortfolios,
  allocationBreakdown,
  xirr,
  periodReturn,
  periodStartFor,
  type CashFlowPoint,
  type PeriodAnchor,
  convert,
  toDateKey,
  fxAvailable,
} from "@portfolio/core";
import { getFxRatesForDates, makeFxRateFn } from "../../services/fx.js";
import { loadSparklines } from "../../services/sparklines.js";
import { enqueueInstrumentMetadata } from "../../services/scheduler.js";
import { needsSectorEnrichment, needsNameEnrichment } from "../../services/instrument-metadata.js";
import { isReadOnlyPat } from "../../plugins/auth.js";
import { mapPool } from "../../lib/promise-pool.js";
import {
  instrumentMeta,
  loadValuation,
  resolveCostBasisMode,
  loadDrift,
  boundaryFlows,
  excludeFxMissingInstruments,
  computePortfolioAnomalies,
  PORTFOLIO_VALUATION_CONCURRENCY,
} from "./shared.js";

export function registerNetworthRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { costBasis?: string; holderId?: string; period?: string } }>(
    "/networth",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const { holderId } = request.query;
      const [u] = await app.db
        .select({ displayCurrency: users.displayCurrency })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const display = u?.displayCurrency ?? "IDR";
      const costBasisMode = await resolveCostBasisMode(app, id, request.query);

      // Period selector: ytd | 1y | 5y | max (default)
      const period = ["ytd", "1y", "5y"].includes(request.query.period ?? "")
        ? (request.query.period as "ytd" | "1y" | "5y")
        : "max";
      // UTC calendar day (audit D9) — snapshot dates are UTC day keys.
      const periodStart = periodStartFor(period, new Date());

      if (holderId != null) {
        const [holder] = await app.db
          .select()
          .from(accountHolders)
          .where(and(eq(accountHolders.id, holderId), eq(accountHolders.userId, id)))
          .limit(1);
        if (!holder) return reply.status(404).send({ error: "holder_not_found" });
      }

      const pfs = await app.db
        .select()
        .from(portfolios)
        .where(
          holderId != null
            ? and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holderId))
            : eq(portfolios.userId, id),
        );

      // Each portfolio's money-weighted flows are computed under its own boundary
      // (cash-inside vs cash-outside), then concatenated — the aggregate spans
      // portfolios with different boundaries, so there is no single boundary to pass.
      // Bounded-concurrency (see PORTFOLIO_VALUATION_CONCURRENCY): each portfolio is
      // independent, so this used to be a serial `for` await — one portfolio's DB round
      // trips blocked the next's. mapPool preserves input order, so the merge below is
      // byte-for-byte identical to the old sequential push loop.
      const perPortfolio = await mapPool(pfs, PORTFOLIO_VALUATION_CONCURRENCY, async (p) => {
        const { coreTxns, summary, corporateActions } = await loadValuation(
          app,
          p.id,
          display,
          costBasisMode,
          p.cashCounted,
        );
        const flows = await boundaryFlows(
          app,
          // Flows and net worth exclude the same fxMissing instruments (audit B2).
          excludeFxMissingInstruments(coreTxns, summary),
          p.cashCounted ? "inside" : "outside",
          display,
          corporateActions,
        );
        return { summary, flows };
      });
      const summaries = perPortfolio.map((r) => r.summary);
      const instrumentIds = new Set<string>();
      const flows: CashFlowPoint[] = perPortfolio.flatMap((r) => r.flows);
      for (const { summary } of perPortfolio) {
        for (const h of summary.holdings) instrumentIds.add(h.instrumentId);
      }

      const aggregated = aggregatePortfolios(summaries, display);
      const meta = await instrumentMeta(app, [...instrumentIds]);
      const spark = await loadSparklines(app.db, [...instrumentIds]);
      const holdings = aggregated.holdings.map((h) => ({
        ...h,
        instrument: meta.get(h.instrumentId) ?? null,
        sparkline: spark.get(h.instrumentId),
      }));

      // Self-heal: enqueue a sector sweep if any held instrument hasn't been
      // enriched yet (or has a stale attempt). Debounced to once per 6h.
      if (needsSectorEnrichment([...meta.values()]) || needsNameEnrichment([...meta.values()])) {
        if (!isReadOnlyPat(request)) void enqueueInstrumentMetadata();
      }

      const asOf = new Date();
      flows.push({ amount: aggregated.netWorth, date: asOf });
      const rate = xirr(flows);

      const allocation = allocationBreakdown(aggregated, meta);
      const drift = await loadDrift(app, id, null, allocation);

      // Period-scoped XIRR and P&L (audit B10): each portfolio is anchored at its OWN
      // earliest snapshot at or after periodStart (FX-converted on that snapshot's date),
      // and only its own boundary flows after that snapshot are netted out — so a deposit
      // inside the period is not reported as profit, and no portfolio's flows are dropped
      // or double-counted by a shared cross-portfolio anchor date.
      let periodResult: { pnl: string; pnlPct: number | null; xirr: number | null } | null = null;
      if (periodStart !== null && pfs.length > 0) {
        const periodStartStr = toDateKey(periodStart);
        const anchors = await mapPool(
          pfs.map((pf, i) => ({ pf, flows: perPortfolio[i]!.flows })),
          PORTFOLIO_VALUATION_CONCURRENCY,
          async ({ pf, flows: pfFlows }): Promise<PeriodAnchor | null> => {
            const [snap] = await app.db
              .select()
              .from(portfolioSnapshots)
              .where(
                and(
                  eq(portfolioSnapshots.portfolioId, pf.id),
                  gte(portfolioSnapshots.date, periodStartStr),
                ),
              )
              .orderBy(asc(portfolioSnapshots.date))
              .limit(1);
            // No snapshot at or after periodStart (brand-new or no history).
            if (!snap) return null;
            const ratesByDate = await getFxRatesForDates(app.db, [snap.currency], display, [
              snap.date,
            ]);
            const fx = makeFxRateFn(ratesByDate.get(snap.date) ?? {}, display);
            // No rate: treat like a missing snapshot — the period figures are withheld
            // rather than built on a 1:1 start NAV (audit B2); reported as fxMissingCurrencies.
            if (!fxAvailable(snap.currency, display, fx)) return null;
            return {
              startNav: convert(snap.netWorth, snap.currency, display, fx),
              snapshotDate: snap.date,
              flows: pfFlows,
            };
          },
        );
        // Only produce period figures when every portfolio has an anchor — a partial sum
        // would under-count the denominator and manufacture phantom period gains.
        if (anchors.every((a) => a !== null)) {
          periodResult = periodReturn(anchors as PeriodAnchor[], aggregated.netWorth, asOf);
        }
      }

      const pXirr = periodResult?.xirr ?? null;
      const periodPnL = periodResult?.pnl ?? null;
      const periodPnLPct =
        periodResult && periodResult.pnlPct !== null ? String(periodResult.pnlPct) : null;

      request.timingName = "GET /networth";
      request.timingMeta = {
        portfolioCount: pfs.length,
        period,
        holderId: holderId ?? null,
        costBasisMode,
      };

      return {
        ...aggregated,
        holdings,
        allocation,
        ...(Object.keys(drift).length > 0 ? { drift } : {}),
        xirr: Number.isFinite(rate) ? rate : null,
        periodXirr: pXirr,
        periodPnL,
        periodPnLPct,
        period,
        portfolioCount: pfs.length,
        asOf: asOf.toISOString(),
      };
    },
  );

  // Aggregate anomalies across all of the user's portfolios (#562): the all-portfolios
  // "Activity" view (no portfolio selected) previously never fetched anomalies at all, so
  // its "Needs review" banner/chip never appeared. Runs the same per-portfolio computation
  // as `GET /portfolios/:id/anomalies` (same cache, same dismissed-anomaly filtering) and
  // merges the results — `transactionId`s are globally-unique, so they map cleanly onto
  // aggregate transaction rows (which carry `portfolioId`).
  app.get("/networth/anomalies", { preHandler: app.authenticate }, async (request) => {
    const id = request.userId;
    const pfs = await app.db.select().from(portfolios).where(eq(portfolios.userId, id));

    const perPortfolio = await mapPool(pfs, PORTFOLIO_VALUATION_CONCURRENCY, (p) =>
      computePortfolioAnomalies(app, p),
    );
    const anomalies = perPortfolio.flat();

    request.timingName = "GET /networth/anomalies";
    request.timingMeta = { portfolioCount: pfs.length, anomalyCount: anomalies.length };
    return { anomalies };
  });
}
