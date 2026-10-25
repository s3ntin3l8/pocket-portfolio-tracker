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
import { getFxRatesForDates, makeFxRateFn, type FxProvider } from "../../services/fx.js";
import { getMarketData } from "../../services/market-data.js";
import { rangeStart } from "../../services/snapshots.js";
import {
  aggregateValueFlows,
  xirr,
  chainIndex,
  twrFields,
  convert,
  fxAvailable,
  toDateKey,
  type FxRateFn,
} from "@portfolio/core";
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
  benchmarkClosesInCurrency,
  computeBenchmarkIndex,
  carryForwardBenchmark,
} from "../../services/benchmark.js";

/**
 * Per-point FX for intraday (1D/7D) rows: each row converts at the rate of its own
 * `capturedAt` UTC date, exactly as the daily series converts each snapshot at its date's
 * rate (#1038), so an FX move inside a 7-day window lands between the points it happened
 * between instead of scaling the whole window by today's rate. `fxProvider` is `null` for a
 * read-scoped PAT (cached rates only, audit A7). A currency without any rate yields `null`
 * from the rate function (never 1:1), which `fxAvailable` turns into an exclusion reported
 * as fxMissingCurrencies.
 *
 * Carry-forward follows the daily series, not `getFxRates`: `getFxRatesForDates` carries a
 * currency's newest cached rate to every later date with no `FX_MAX_CARRY_FORWARD_DAYS`
 * bound (that bound only gates its back-fill), so a currency whose newest rate is older
 * than 14 days still converts here, exactly as the same day does in the daily series.
 */
async function intradayFxAt(
  app: FastifyInstance,
  rows: { currency: string; capturedAt: Date }[],
  target: string,
  fxProvider: FxProvider | null | undefined,
): Promise<(row: { capturedAt: Date }) => FxRateFn> {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  const dates = [...new Set(rows.map((r) => toDateKey(r.capturedAt)))];
  const ratesByDate = await getFxRatesForDates(app.db, currencies, target, dates, fxProvider);
  const byDate = new Map(
    [...ratesByDate.entries()].map(([d, rates]) => [d, makeFxRateFn(rates, target)]),
  );
  return (row) => byDate.get(toDateKey(row.capturedAt)) ?? makeFxRateFn({}, target);
}

export function registerHistoryRoutes(app: FastifyInstance) {
  // Net-worth-over-time for one portfolio, from the daily snapshots, in the portfolio's
  // current base currency. Snapshot rows keep the currency they were written in, so after a
  // `baseCurrency` change the table holds two currencies (#1031): every row is converted
  // from its own currency at its own date's rate (never 1:1) before the TWR index is
  // chained, exactly as /networth/history converts into the display currency.
  app.get<{ Params: PortfolioParams; Querystring: { range?: string } }>(
    "/portfolios/:portfolioId/history",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      request.timingName = "GET /portfolios/:id/history";
      const { portfolioId } = request.params;
      const range = request.query.range ?? "1y";
      const base = request.portfolio!.baseCurrency;
      const readOnlyPat = isReadOnlyPat(request);
      // A read-scoped PAT converts with cached rates only (no provider fetch/persist).
      const fxProvider = readOnlyPat ? null : undefined;

      // 1D/7D: read the intraday (timestamped) table instead of the day-grained one.
      // No stored intraday history exists to backfill — this is prospective-only, so an
      // empty array is a normal, expected response until the capture job has run.
      if (range === "1d" || range === "7d") {
        const since = new Date(Date.now() - (range === "1d" ? 1 : 7) * 86_400_000);
        const intradayRows = await app.db
          .select()
          .from(portfolioIntradaySnapshots)
          .where(
            and(
              eq(portfolioIntradaySnapshots.portfolioId, portfolioId),
              gte(portfolioIntradaySnapshots.capturedAt, since),
            ),
          )
          .orderBy(asc(portfolioIntradaySnapshots.capturedAt));
        // Same as the aggregate intraday series: each point at its capture date's rate into
        // the current base; a row whose currency has none is left out and reported as
        // fxMissingCurrencies.
        const fxAt = await intradayFxAt(app, intradayRows, base, fxProvider);
        const rows = intradayRows.filter((r) => fxAvailable(r.currency, base, fxAt(r)));
        request.timingMeta = {
          portfolioId,
          range,
          pointCount: rows.length,
        };
        return rows.map((r) => ({
          at: r.capturedAt.toISOString(),
          netWorth: convert(r.netWorth, r.currency, base, fxAt(r)),
          marketValue: convert(r.marketValue ?? "0", r.currency, base, fxAt(r)),
        }));
      }

      const result = await withDerivationCache(
        historyCache,
        // A read-scoped PAT's benchmark-less, cached-FX-only variant gets its own entry
        // (withDerivationCache keys it apart), so it can't serve a degraded series to others.
        `${portfolioId}:${range}`,
        async () => {
          const start = rangeStart(range);
          const conds = [eq(portfolioSnapshots.portfolioId, portfolioId)];
          if (start) conds.push(gte(portfolioSnapshots.date, start));
          const snapRows = await app.db
            .select()
            .from(portfolioSnapshots)
            .where(and(...conds))
            .orderBy(asc(portfolioSnapshots.date));

          // One per-date rate load for the snapshot currencies and the benchmark's, so both
          // convert into the current base at the same rates (#1020, #1031).
          const userId = request.userId;
          const bmConfig = await getUserBenchmarkConfig(app.db, userId, "");
          const currencies = [...new Set([...snapRows.map((r) => r.currency), bmConfig.currency])];
          const dates = [...new Set(snapRows.map((r) => r.date))];
          const ratesByDate = await getFxRatesForDates(app.db, currencies, base, dates, fxProvider);
          // Rows whose currency has no rate are left out (never 1:1, audit B2) and reported
          // as fxMissingCurrencies. `getFxRatesForDates` carries a currency's known rates
          // forward (and its earliest back) over every wanted date, so exclusion is
          // all-or-nothing per currency: a pre-switch currency without any rate drops out as
          // a whole leg, never as single days.
          const rows: {
            date: string;
            netWorth: string;
            marketValue: string;
            effectiveFlow: string;
          }[] = [];
          for (const r of snapRows) {
            const fx = makeFxRateFn(ratesByDate.get(r.date) ?? {}, base);
            if (!fxAvailable(r.currency, base, fx)) continue;
            rows.push({
              date: r.date,
              netWorth: convert(r.netWorth, r.currency, base, fx),
              marketValue: convert(r.marketValue ?? "0", r.currency, base, fx),
              effectiveFlow: convert(r.effectiveFlow ?? "0", r.currency, base, fx),
            });
          }

          // Compute TWR chain from the converted (marketValue, effectiveFlow) pairs.
          const indexed = chainIndex(rows);
          const indexById = new Map(indexed.map((p) => [p.date, p]));

          const result = rows.map((r) => ({
            date: r.date,
            netWorth: r.netWorth,
            marketValue: r.marketValue,
            // A date without a TWR point has NO index and NO percentage — it does not have
            // 0 % (audit R4-E5). The fields are left off the row instead of carrying a
            // fabricated "100"/"0", and the chart breaks the line there (a missing value
            // must not be drawn as a −100 % cliff). `chainIndex` emits a point per date,
            // so this is the unreachable branch — but it is the one that would lie.
            ...twrFields(indexById, r.date),
          }));

          // Benchmark enrichment — same pattern as /networth/history, except the target
          // currency is the portfolio's current base currency. The benchmark is converted
          // into it at each date's FX rate (#1020): a native-currency index would leave out
          // the FX move that the portfolio's own index includes. Lives inside the cache
          // callback so the `userPreferences`/`benchmarkPrices`/FX queries + possible
          // market-data fetch are skipped on repeated calls for the same (portfolioId, range).
          if (result.length > 0) {
            const bmDates = result.map((p) => p.date);
            if (!readOnlyPat) {
              await ensureBenchmarkPrices(app.db, getMarketData, userId, bmConfig.symbol, bmDates);
            }
            const refreshedBm = await getBenchmarkPrices(app.db, userId, bmConfig.symbol, bmDates);
            if (refreshedBm.size >= 1) {
              // `ratesByDate` was loaded cached-only for a read-scoped PAT, like the benchmark
              // prices above. Days without a rate drop out (never 1:1).
              const { closes: bmPrices, fxMissingDates } = await benchmarkClosesInCurrency(
                app.db,
                refreshedBm,
                bmDates,
                bmConfig.currency,
                base,
                { ratesByDate },
              );
              if (fxMissingDates > 0) {
                request.log.warn(
                  { portfolioId, symbol: bmConfig.symbol, missingDates: fxMissingDates },
                  "history: benchmark FX rate missing for some dates — those days dropped",
                );
              }
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
      // A read-scoped PAT values and converts with cached FX rates only (audit A7); its
      // possibly-degraded result is cached under its own key (withDerivationCache).
      const readOnlyPat = isReadOnlyPat(request);
      const fxProvider = readOnlyPat ? null : undefined;
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
            undefined,
            fxProvider,
          );

          // Flows and net worth exclude the same fxMissing instruments (audit B2).
          const flows = await boundaryFlows(
            app,
            excludeFxMissingInstruments(coreTxns, summary),
            boundary,
            portfolio.baseCurrency,
            corporateActions,
            "today",
            fxProvider,
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
    // A read-scoped PAT converts with cached rates only (no provider fetch/persist, audit
    // A7) — the snapshot, intraday and benchmark rates alike, as /portfolios/:id/history.
    const fxProvider = readOnlyPat ? null : undefined;
    // A read PAT's result gets its own cache entry (withDerivationCache keys it apart).
    const ck = cacheKey(id, range, holderId ?? "", includeParam, excludeParam);
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

        // Each point at its capture date's rate (#1038). A portfolio whose base currency has
        // no rate is left out (never 1:1, audit B2); the miss is reported as
        // fxMissingCurrencies via the request scope.
        const fxAt = await intradayFxAt(app, intradayRows, display, fxProvider);
        const rows = intradayRows.filter((r) => fxAvailable(r.currency, display, fxAt(r)));

        // Decimal sums (audit B12) — these are serialised as money strings.
        const byAt = new Map<string, { netWorth: Decimal; marketValue: Decimal }>();
        for (const r of rows) {
          const at = r.capturedAt.toISOString();
          const entry = byAt.get(at) ?? { netWorth: new Decimal(0), marketValue: new Decimal(0) };
          const fx = fxAt(r);
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

      // One per-date rate load for the snapshot currencies and the benchmark's, so both
      // convert at the same rates (#1020); cached-only for a read-scoped PAT (#1039), like
      // its benchmark prices below.
      const bmConfig = await getUserBenchmarkConfig(app.db, id, display);
      const currencies = [...new Set([...snapRows.map((r) => r.currency), bmConfig.currency])];
      const dates = [...new Set(snapRows.map((r) => r.date))];
      const ratesByDate = await getFxRatesForDates(app.db, currencies, display, dates, fxProvider);
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
        // No TWR point for the date → no index and no percentage (audit R4-E5). The
        // fields are left off rather than carrying a fabricated "100"/"0".
        ...twrFields(indexById, p.date),
      }));

      // Benchmark comparison: fetch prices and compute parallel TWR index.
      if (result.length > 0) {
        const bmDates = result.map((p) => p.date);
        if (!readOnlyPat) {
          await ensureBenchmarkPrices(app.db, getMarketData, id, bmConfig.symbol, bmDates);
        }
        const refreshedBm = await getBenchmarkPrices(app.db, id, bmConfig.symbol, bmDates);
        if (refreshedBm.size >= 1) {
          // In the display currency, at each date's FX rate — the same series the
          // Insights card and per-year table compare against (#1020). `ratesByDate` was
          // loaded cached-only for a read-scoped PAT.
          const { closes: bmPrices, fxMissingDates } = await benchmarkClosesInCurrency(
            app.db,
            refreshedBm,
            bmDates,
            bmConfig.currency,
            display,
            { ratesByDate },
          );
          if (fxMissingDates > 0) {
            request.log.warn(
              { symbol: bmConfig.symbol, display, missingDates: fxMissingDates },
              "networth history: benchmark FX rate missing for some dates — those days dropped",
            );
          }
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
