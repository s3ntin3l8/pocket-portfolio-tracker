import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { portfolios, portfolioSnapshots, userPreferences, users } from "@portfolio/db";
import {
  aggregateValueFlows,
  chainIndex,
  convert,
  dailyReturns,
  annualizedVolatility,
  sharpeRatio,
  sortinoRatio,
  streakAnalysis,
  maxDrawdown,
} from "@portfolio/core";
import { getFxRatesForDates, makeFxRateFn } from "../../services/fx.js";
import { getMarketData } from "../../services/market-data.js";
import {
  getUserBenchmarkConfig,
  fetchBenchmarkPrices,
  getBenchmarkPrices,
  computeBenchmarkIndex,
  computeActiveReturn,
} from "../../services/benchmark.js";
import { rangeStart } from "../../services/snapshots.js";
import { cacheKey } from "../helpers.js";
import { insightsCache } from "./shared.js";
import { withDerivationCache } from "../../lib/derivation-cache.js";
import { emptyInsightsResponse } from "./insights/defaults.js";
import { computeConcentrationSection } from "./insights/concentration.js";

export function registerInsightsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { range?: string; holderId?: string; portfolioId?: string } }>(
    "/insights",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const { holderId, portfolioId } = request.query;
      const range = request.query.range ?? "all";

      const pfs = await app.db
        .select({
          id: portfolios.id,
          includeInAggregate: portfolios.includeInAggregate,
          cashCounted: portfolios.cashCounted,
        })
        .from(portfolios)
        .where(
          portfolioId != null
            ? and(eq(portfolios.userId, id), eq(portfolios.id, portfolioId))
            : holderId != null
              ? and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holderId))
              : eq(portfolios.userId, id),
        );
      if (pfs.length === 0) {
        return reply.send(emptyInsightsResponse());
      }

      const [u] = await app.db
        .select({ displayCurrency: users.displayCurrency })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const display = u?.displayCurrency ?? "IDR";

      const ck = cacheKey("insights", id, range, holderId ?? "", portfolioId ?? "");
      const result = await withDerivationCache(insightsCache, ck, async () => {
        // ── Portfolio history (TWR index) ──────────────────────────────
        const start = rangeStart(range);
        const conds = [
          inArray(
            portfolioSnapshots.portfolioId,
            pfs.map((p) => p.id),
          ),
        ];
        if (start) conds.push(gte(portfolioSnapshots.date, start));
        const snapshots = await app.db
          .select()
          .from(portfolioSnapshots)
          .where(and(...conds))
          .orderBy(asc(portfolioSnapshots.date));

        if (snapshots.length === 0) {
          return emptyInsightsResponse();
        }

        const bmConfig = await getUserBenchmarkConfig(app.db, id, display);

        const currencies = [...new Set([...snapshots.map((r) => r.currency), bmConfig.currency])];
        const dates = [...new Set(snapshots.map((r) => r.date))];
        const ratesByDate = await getFxRatesForDates(app.db, currencies, display, dates);

        const perPortfolio = new Map<
          string,
          {
            date: string;
            marketValue: string;
            effectiveFlow: string;
            netWorth: string;
            currency: string;
          }[]
        >();
        for (const r of snapshots) {
          const list = perPortfolio.get(r.portfolioId) ?? [];
          list.push(r);
          perPortfolio.set(r.portfolioId, list);
        }

        const allFlows: { date: string; marketValue: string; effectiveFlow: string }[][] = [];
        for (const [, pfRows] of perPortfolio) {
          const converted = pfRows.map((r) => {
            const fx = makeFxRateFn(ratesByDate.get(r.date) ?? {}, display);
            return {
              date: r.date,
              marketValue: convert(r.marketValue ?? "0", r.currency, display, fx),
              effectiveFlow: convert(r.effectiveFlow ?? "0", r.currency, display, fx),
            };
          });
          allFlows.push(converted);
        }

        const aggregated = aggregateValueFlows(allFlows);
        const indexed = chainIndex(aggregated);

        // ── Drawdown ───────────────────────────────────────────────────
        const drawdown = maxDrawdown(indexed.map((p) => ({ date: p.date, netWorth: p.index })));

        // ── Volatility & Sharpe ────────────────────────────────────────
        const idxPoints = indexed.map((p) => ({ date: p.date, index: p.index }));
        const returns = dailyReturns(idxPoints);

        const [rfrPref] = await app.db
          .select({ rate: userPreferences.riskFreeRate })
          .from(userPreferences)
          .where(eq(userPreferences.userId, id))
          .limit(1);
        const autoRfr: Record<string, number> = { EUR: 0.03, USD: 0.05, IDR: 0.06 };
        const riskFreeRate = Number(rfrPref?.rate ?? autoRfr[display] ?? 0.04);
        const volatility = {
          annualizedVolatility: returns.length >= 2 ? String(annualizedVolatility(returns)) : null,
          sharpeRatio: returns.length >= 2 ? String(sharpeRatio(returns, riskFreeRate)) : null,
          sortinoRatio: returns.length >= 2 ? String(sortinoRatio(returns, riskFreeRate)) : null,
        };

        // ── Streaks ────────────────────────────────────────────────────
        const streaks = streakAnalysis(idxPoints);

        // ── Benchmark comparison ───────────────────────────────────────
        let benchmark: {
          symbol: string;
          activeReturn: string;
          trackingError: string;
          correlation: string;
        } | null = null;
        if (indexed.length > 0) {
          const bmDates = indexed.map((p) => p.date);
          const existingBm = await getBenchmarkPrices(app.db, id, bmConfig.symbol, bmDates);
          const missingDates = bmDates.filter((d) => !existingBm.has(d));
          if (missingDates.length > 0) {
            try {
              const md = await getMarketData();
              await fetchBenchmarkPrices(app.db, md, id, bmConfig.symbol, missingDates[0]);
            } catch {
              /* non-fatal */
            }
          }
          const refreshedBm = await getBenchmarkPrices(app.db, id, bmConfig.symbol, bmDates);
          if (refreshedBm.size > 1) {
            let bmFxMissingDates = 0;
            const bmPrices = bmDates
              .filter((d) => refreshedBm.has(d))
              .map((d) => {
                const dayRates = ratesByDate.get(d) ?? {};
                if (bmConfig.currency !== display && !dayRates[bmConfig.currency])
                  bmFxMissingDates++;
                const fx = makeFxRateFn(dayRates, display);
                return {
                  date: d,
                  close: convert(refreshedBm.get(d)!, bmConfig.currency, display, fx),
                };
              });
            if (bmFxMissingDates > 0) {
              app.log.warn(
                {
                  userId: id,
                  symbol: bmConfig.symbol,
                  currency: bmConfig.currency,
                  display,
                  missingDates: bmFxMissingDates,
                },
                "insights: benchmark FX rate missing for some dates — those days left unconverted",
              );
            }
            const bmIndex = computeBenchmarkIndex(bmPrices);
            const active = computeActiveReturn(
              indexed.map((p) => ({ date: p.date, pct: p.pct })),
              bmIndex.map((p) => ({ date: p.date, pct: p.pct })),
            );
            if (active) {
              benchmark = { symbol: bmConfig.symbol, ...active };
            }
          }
        }

        // ── Concentration trend (monthly, simplified) ──────────────────
        const { concentrationTrend, bestWorstMonthly, bestWorstYearly } =
          await computeConcentrationSection(
            app,
            pfs.map((p) => p.id),
            dates,
          );

        return {
          drawdown,
          volatility,
          streaks,
          benchmark,
          concentrationTrend,
          bestWorstMonthly,
          bestWorstYearly,
        };
      });

      request.timingName = "GET /insights";
      request.timingMeta = {};
      return result;
    },
  );
}
