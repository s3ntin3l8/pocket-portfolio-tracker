import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { and, asc, countDistinct, eq, gte, inArray } from "drizzle-orm";
import {
  accountHolders,
  portfolios,
  users,
  portfolioIntradaySnapshots,
  portfolioSnapshots,
} from "@portfolio/db";
import { getFxRates, getFxRatesForDates, makeFxRateFn } from "../../services/fx.js";
import { getMarketData } from "../../services/market-data.js";
import { rangeStart } from "../../services/snapshots.js";
import { aggregateValueFlows, xirr, chainIndex, convert, fxAvailable } from "@portfolio/core";
import { cacheKey } from "../helpers.js";
import { isReadOnlyPat } from "../../plugins/auth.js";
import type { PortfolioParams } from "./shared.js";
import {
  loadValuation,
  resolveCostBasisMode,
  historyCache,
  intradayStatusCache,
  performanceCache,
  boundaryFlows,
  excludeFxMissingInstruments,
} from "./shared.js";
import { withDerivationCache } from "../../lib/derivation-cache.js";
import {
  getUserBenchmarkConfig,
  ensureBenchmarkPrices,
  getBenchmarkPrices,
  computeBenchmarkIndex,
  carryForwardBenchmark,
} from "../../services/benchmark.js";

export function registerHistoryRoutes(app: FastifyInstance) {
  // Net-worth-over-time for one portfolio, from the daily snapshots (base currency).
  app.get<{ Params: PortfolioParams; Querystring: { range?: string } }>(
    "/portfolios/:portfolioId/history",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      request.timingName = "GET /portfolios/:id/history";
      const { portfolioId } = request.params;
      const range = request.query.range ?? "1y";

      // 1D/7D: read the intraday (timestamped) table instead of the day-grained one.
      // No stored intraday history exists to backfill — this is prospective-only, so an
      // empty array is a normal, expected response until the capture job has run.
      if (range === "1d" || range === "7d") {
        const since = new Date(Date.now() - (range === "1d" ? 1 : 7) * 86_400_000);
        const rows = await app.db
          .select()
          .from(portfolioIntradaySnapshots)
          .where(
            and(
              eq(portfolioIntradaySnapshots.portfolioId, portfolioId),
              gte(portfolioIntradaySnapshots.capturedAt, since),
            ),
          )
          .orderBy(asc(portfolioIntradaySnapshots.capturedAt));
        request.timingMeta = {
          portfolioId,
          range,
          pointCount: rows.length,
        };
        return rows.map((r) => ({
          at: r.capturedAt.toISOString(),
          netWorth: r.netWorth,
          marketValue: r.marketValue ?? "0",
        }));
      }

      const result = await withDerivationCache(
        historyCache,
        // A read-scoped PAT gets a benchmark-less variant (no provider fetch/persist);
        // keep it out of the shared entry so it can't serve a degraded series to others.
        `${portfolioId}:${range}${isReadOnlyPat(request) ? ":ro" : ""}`,
        async () => {
          const start = rangeStart(range);
          const conds = [eq(portfolioSnapshots.portfolioId, portfolioId)];
          if (start) conds.push(gte(portfolioSnapshots.date, start));
          const rows = await app.db
            .select()
            .from(portfolioSnapshots)
            .where(and(...conds))
            .orderBy(asc(portfolioSnapshots.date));

          // Compute TWR chain from stored (marketValue, effectiveFlow) pairs.
          const series = rows.map((r) => ({
            date: r.date,
            marketValue: r.marketValue ?? "0",
            effectiveFlow: r.effectiveFlow ?? "0",
          }));
          const indexed = chainIndex(series);
          const indexById = new Map(indexed.map((p) => [p.date, p]));

          const result = rows.map((r) => ({
            date: r.date,
            netWorth: r.netWorth,
            marketValue: r.marketValue ?? "0",
            index: indexById.get(r.date)?.index ?? "100",
            pct: indexById.get(r.date)?.pct ?? "0",
          }));

          // Benchmark enrichment — same pattern as /networth/history, minus the
          // display currency (this endpoint returns snapshots in their stored
          // base currency; the benchmark is a separate indexed series, so no FX
          // conversion is involved). Lives inside the cache callback so the
          // 2× `userPreferences`/`benchmarkPrices` queries + possible market-data
          // fetch are skipped on repeated calls for the same (portfolioId, range).
          const userId = request.userId;
          const bmConfig = await getUserBenchmarkConfig(app.db, userId, "");
          if (result.length > 0) {
            const bmDates = result.map((p) => p.date);
            if (!isReadOnlyPat(request)) {
              await ensureBenchmarkPrices(app.db, getMarketData, userId, bmConfig.symbol, bmDates);
            }
            const refreshedBm = await getBenchmarkPrices(app.db, userId, bmConfig.symbol, bmDates);
            if (refreshedBm.size >= 1) {
              const bmPrices = bmDates
                .filter((d) => refreshedBm.has(d))
                .map((d) => ({ date: d, close: refreshedBm.get(d)! }));
              const bmIndex = computeBenchmarkIndex(bmPrices);
              const bmById = new Map(bmIndex.map((p) => [p.date, p]));
              carryForwardBenchmark(
                result as { date: string; benchmarkIndex?: string; benchmarkPct?: string }[],
                bmById,
              );
            }
          }
          return result;
        },
      );

      request.timingMeta = {
        portfolioId,
        range,
        pointCount: result.length,
      };
      return result;
    },
  );

  // Money-weighted return (XIRR) from external cash flows + current net worth.
  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/performance",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      const { portfolioId } = request.params;
      const portfolio = request.portfolio;
      const boundary = portfolio.cashCounted ? "inside" : "outside";
      const costBasisMode = await resolveCostBasisMode(app, request.userId);
      const cached = await withDerivationCache(
        performanceCache,
        `${portfolioId}:${boundary}`,
        async () => {
          const { coreTxns, summary, corporateActions } = await loadValuation(
            app,
            portfolioId,
            portfolio.baseCurrency,
            costBasisMode,
            portfolio.cashCounted,
          );

          // Flows and net worth exclude the same fxMissing instruments (audit B2).
          const flows = await boundaryFlows(
            app,
            excludeFxMissingInstruments(coreTxns, summary),
            boundary,
            portfolio.baseCurrency,
            corporateActions,
          );
          const asOf = new Date();
          flows.push({ amount: summary.netWorth, date: asOf });

          const rate = xirr(flows);
          return {
            xirr: Number.isFinite(rate) ? rate : null,
            netWorth: summary.netWorth,
            asOf: asOf.toISOString(),
          };
        },
      );
      request.timingName = "GET /portfolios/:id/performance";
      request.timingMeta = {
        portfolioId,
      };
      return cached;
    },
  );

  // Whether the 1D/7D hero ranges have anything to draw yet (audit G8): at least two
  // distinct intraday capture times in the last 7 days across the user's portfolios — the
  // same "two points make a line" threshold the chart itself uses. Lets a fresh install hide
  // those chips instead of showing a "collecting" placeholder. Prospective-only data, so
  // this flips true on its own a day or so after the intraday job starts running.
  // Cached like the sibling history routes (the hero asks on every Holdings navigation);
  // cleared on any write, otherwise at most 60 s stale, which only delays the chips appearing.
  app.get("/networth/intraday-status", { preHandler: app.authenticate }, async (request) => {
    const userId = request.userId;
    return withDerivationCache(intradayStatusCache, userId, async () => {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const [row] = await app.db
        .select({ n: countDistinct(portfolioIntradaySnapshots.capturedAt) })
        .from(portfolioIntradaySnapshots)
        .innerJoin(portfolios, eq(portfolios.id, portfolioIntradaySnapshots.portfolioId))
        .where(
          and(eq(portfolios.userId, userId), gte(portfolioIntradaySnapshots.capturedAt, since)),
        );
      return { hasIntraday: Number(row?.n ?? 0) >= 2 };
    });
  });

  // Aggregate net-worth-over-time across all of the user's portfolios, summing each
  // day's snapshots converted to the display currency.
  app.get<{
    Querystring: { range?: string; include?: string; exclude?: string; holderId?: string };
  }>("/networth/history", { preHandler: app.authenticate }, async (request, reply) => {
    const id = request.userId;
    const { holderId } = request.query;
    const range = request.query.range ?? "1y";
    const includeParam = request.query.include ?? "";
    const excludeParam = request.query.exclude ?? "";

    if (holderId != null) {
      const [holder] = await app.db
        .select()
        .from(accountHolders)
        .where(and(eq(accountHolders.id, holderId), eq(accountHolders.userId, id)))
        .limit(1);
      if (!holder) return reply.status(404).send({ error: "holder_not_found" });
    }

    const pfs = await app.db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(
        holderId != null
          ? and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holderId))
          : eq(portfolios.userId, id),
      );
    if (pfs.length === 0) return [];

    // "All portfolios" means every portfolio the user owns — matches /networth and
    // /insights. `include`/`exclude` remain as ad hoc, request-scoped overrides (not
    // currently sent by the web client); there is no persisted aggregate-membership
    // flag anymore (see the removal of `portfolios.includeInAggregate`).
    const pfIds = (() => {
      const inc = includeParam.split(",").filter(Boolean);
      const exc = excludeParam.split(",").filter(Boolean);
      if (inc.length > 0) {
        return pfs.filter((p) => inc.includes(p.id)).map((p) => p.id);
      }
      return pfs.filter((p) => !exc.includes(p.id)).map((p) => p.id);
    })();
    if (pfIds.length === 0) return [];

    const [u] = await app.db
      .select({ displayCurrency: users.displayCurrency })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const display = u?.displayCurrency ?? "IDR";

    const readOnlyPat = isReadOnlyPat(request);
    const ck =
      cacheKey(id, range, holderId ?? "", includeParam, excludeParam) + (readOnlyPat ? ":ro" : "");
    const cached = await withDerivationCache(historyCache, ck, async () => {
      // 1D/7D: aggregate the intraday (timestamped) table instead of the day-grained one.
      if (range === "1d" || range === "7d") {
        const since = new Date(Date.now() - (range === "1d" ? 1 : 7) * 86_400_000);
        const intradayRows = await app.db
          .select()
          .from(portfolioIntradaySnapshots)
          .where(
            and(
              inArray(portfolioIntradaySnapshots.portfolioId, pfIds),
              gte(portfolioIntradaySnapshots.capturedAt, since),
            ),
          )
          .orderBy(asc(portfolioIntradaySnapshots.capturedAt));
        if (intradayRows.length === 0) return [];

        const currencies = [...new Set(intradayRows.map((r) => r.currency))];
        const fx = makeFxRateFn(await getFxRates(app.db, currencies, display), display);
        // A portfolio whose base currency has no rate is left out (never 1:1, audit B2);
        // the miss is reported as fxMissingCurrencies via the request scope.
        const rows = intradayRows.filter((r) => fxAvailable(r.currency, display, fx));

        // Decimal sums (audit B12) — these are serialised as money strings.
        const byAt = new Map<string, { netWorth: Decimal; marketValue: Decimal }>();
        for (const r of rows) {
          const at = r.capturedAt.toISOString();
          const entry = byAt.get(at) ?? { netWorth: new Decimal(0), marketValue: new Decimal(0) };
          entry.netWorth = entry.netWorth.add(convert(r.netWorth, r.currency, display, fx));
          entry.marketValue = entry.marketValue.add(
            convert(r.marketValue ?? "0", r.currency, display, fx),
          );
          byAt.set(at, entry);
        }
        return [...byAt.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([at, v]) => ({
            at,
            netWorth: v.netWorth.toFixed(),
            marketValue: v.marketValue.toFixed(),
          }));
      }

      const start = rangeStart(range);
      const conds = [inArray(portfolioSnapshots.portfolioId, pfIds)];
      if (start) conds.push(gte(portfolioSnapshots.date, start));
      const snapRows = await app.db
        .select()
        .from(portfolioSnapshots)
        .where(and(...conds))
        .orderBy(asc(portfolioSnapshots.date));

      const currencies = [...new Set(snapRows.map((r) => r.currency))];
      const dates = [...new Set(snapRows.map((r) => r.date))];
      const ratesByDate = await getFxRatesForDates(app.db, currencies, display, dates);
      // Rows whose currency has no rate are left out (never 1:1, audit B2) and reported as
      // fxMissingCurrencies. Rates carry forward/back over the whole date grid, so this
      // drops a portfolio's whole leg consistently, never single days of it.
      const rows = snapRows.filter((r) =>
        fxAvailable(r.currency, display, makeFxRateFn(ratesByDate.get(r.date) ?? {}, display)),
      );

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
      for (const r of rows) {
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
      const indexById = new Map(indexed.map((p) => [p.date, p]));

      const nwByDate = new Map<string, Decimal>();
      for (const r of rows) {
        const fx = makeFxRateFn(ratesByDate.get(r.date) ?? {}, display);
        const nw = convert(r.netWorth, r.currency, display, fx);
        nwByDate.set(r.date, (nwByDate.get(r.date) ?? new Decimal(0)).add(nw));
      }

      const result = aggregated.map((p) => ({
        date: p.date,
        netWorth: (nwByDate.get(p.date) ?? new Decimal(0)).toFixed(),
        marketValue: p.marketValue,
        index: indexById.get(p.date)?.index ?? "100",
        pct: indexById.get(p.date)?.pct ?? "0",
      }));

      // Benchmark comparison: fetch prices and compute parallel TWR index.
      const bmConfig = await getUserBenchmarkConfig(app.db, id, display);
      if (result.length > 0) {
        const bmDates = result.map((p) => p.date);
        if (!readOnlyPat) {
          await ensureBenchmarkPrices(app.db, getMarketData, id, bmConfig.symbol, bmDates);
        }
        const refreshedBm = await getBenchmarkPrices(app.db, id, bmConfig.symbol, bmDates);
        if (refreshedBm.size >= 1) {
          const bmPrices = bmDates
            .filter((d) => refreshedBm.has(d))
            .map((d) => ({ date: d, close: refreshedBm.get(d)! }));
          const bmIndex = computeBenchmarkIndex(bmPrices);
          const bmById = new Map(bmIndex.map((p) => [p.date, p]));
          carryForwardBenchmark(
            result as { date: string; benchmarkIndex?: string; benchmarkPct?: string }[],
            bmById,
          );
        }
      }

      return result;
    });
    request.timingName = "GET /networth/history";
    request.timingMeta = {
      portfolioCount: cached.length,
      range,
      resultCount: cached.length,
    };
    return cached;
  });
}
