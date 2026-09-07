import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { accountHolders, portfolios, users, userPreferences } from "@portfolio/db";
import type { TradeLog } from "@portfolio/core";
import { allowanceUsageYTD, harvestSuggestions, mergeTradeLogs } from "@portfolio/core";
import { Decimal } from "decimal.js";
import {
  derivationCacheKey,
  getCachedFifoTradeLog,
  type InstrumentMeta,
} from "../../services/valuation.js";
import { mapPool } from "../../lib/promise-pool.js";
import { toDecimalSafe } from "../../lib/decimal-safe.js";

/**
 * Coerce Drizzle's `fxRates: Record<string, string>` (returned by loadValuation) into the
 * `Map<string, number>` shape `computeIndonesianFinalTaxFromTradeLog` expects. The Record
 * format uses stringified decimals to survive JSON serialization; the ID tax math needs
 * the numeric form.
 */
function makeIdFxRateMap(fxRates: Record<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(fxRates)) out.set(k, Number(v));
  return out;
}

import {
  loadValuation,
  buildTradeLog,
  PORTFOLIO_VALUATION_CONCURRENCY,
  type PortfolioParams,
} from "./shared.js";
import {
  lossCarryForwardFor,
  restOfYearForecastGross,
  buildTfRates,
  computeIndonesianFinalTaxFromTradeLog,
} from "./tax-helpers.js";

export function registerTaxRoutes(app: FastifyInstance) {
  /**
   * GET /portfolios/:portfolioId/tax
   * German Sparerpauschbetrag headroom and harvest suggestions for a single portfolio.
   * The portfolio's own `taxAllowanceAnnual` (the per-depot Freistellungsauftrag slice)
   * must be configured. The holder's capitalGainsTaxRate is used for the tax rate;
   * the holder's taxAllowanceAnnual is the per-person cap (used for the distribution
   * helper returned in the response so the edit modal can show "€X of €cap allocated").
   */
  app.get<{ Params: PortfolioParams; Querystring: { year?: string } }>(
    "/portfolios/:portfolioId/tax",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const portfolio = request.portfolio;

      // Tax regime comes from userPreferences; default is "DE". The Indonesian path does
      // NOT require the holder/portfolio FSA allocation that the DE Sparerpauschbetrag
      // path needs — ID is a flat, withheld-at-source regime with no annual allowance.
      const [prefs] = await app.db
        .select({ taxRegime: userPreferences.taxRegime })
        .from(userPreferences)
        .where(eq(userPreferences.userId, id))
        .limit(1);
      const regime: "DE" | "ID" = prefs?.taxRegime === "ID" ? "ID" : "DE";

      if (regime === "DE" && !portfolio.taxAllowanceAnnual) {
        return reply.code(422).send({ error: "tax_allowance_not_configured" });
      }

      const now = new Date();
      const year = request.query.year ? parseInt(request.query.year, 10) : now.getUTCFullYear();

      const holderId = portfolio.accountHolderId;
      let holderProfile: {
        taxAllowanceAnnual: string | null;
        capitalGainsTaxRate: string | null;
      } | null = null;
      let totalAllocatedForHolder = toDecimalSafe(portfolio.taxAllowanceAnnual);
      let lossCarryForwardInput: { stock?: string; general?: string } | undefined;
      let carryForwardApplied = false;

      if (holderId) {
        const [holderResult, siblingRows, lossCarryForwardResult] = await Promise.all([
          app.db
            .select({
              taxAllowanceAnnual: accountHolders.taxAllowanceAnnual,
              capitalGainsTaxRate: accountHolders.capitalGainsTaxRate,
            })
            .from(accountHolders)
            .where(and(eq(accountHolders.id, holderId), eq(accountHolders.userId, id)))
            .limit(1),
          app.db
            .select({ taxAllowanceAnnual: portfolios.taxAllowanceAnnual })
            .from(portfolios)
            .where(and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holderId))),
          lossCarryForwardFor(app, holderId, year),
        ]);
        const [holder] = holderResult;
        if (holder) holderProfile = holder;

        totalAllocatedForHolder = siblingRows.reduce(
          (sum, p) => sum.plus(toDecimalSafe(p.taxAllowanceAnnual)),
          new Decimal(0),
        );

        if (siblingRows.length <= 1) {
          lossCarryForwardInput = lossCarryForwardResult;
          carryForwardApplied = true;
        }
      }

      const holderAllowanceCap = new Decimal(holderProfile?.taxAllowanceAnnual ?? 1000);
      const remainingToDistribute = Decimal.max(
        new Decimal(0),
        holderAllowanceCap.minus(totalAllocatedForHolder),
      );
      const overAllocated = totalAllocatedForHolder.gt(holderAllowanceCap);

      const valuation = await loadValuation(
        app,
        portfolioId,
        portfolio.baseCurrency,
        undefined,
        portfolio.cashCounted,
      );
      const { coreTxns, prices, metaById, corporateActions: cas, fxRates } = valuation;
      const cacheKey = derivationCacheKey(
        portfolioId,
        portfolio.baseCurrency,
        undefined,
        portfolio.cashCounted,
      );
      const tradeLog = await getCachedFifoTradeLog(
        cacheKey,
        coreTxns,
        prices,
        portfolio.baseCurrency,
        metaById,
        cas,
        fxRates,
      );
      const tfRates = buildTfRates(tradeLog.trades, metaById);
      const assetClasses = Object.fromEntries(
        [...metaById.entries()].map(([iid, m]) => [iid, m.assetClass]),
      );
      // Skip the rest-of-year forecast under ID — the German branch is the only consumer.
      const forecastIncomeRestOfYear =
        regime === "ID"
          ? "0"
          : (
              await restOfYearForecastGross(
                app,
                coreTxns,
                valuation.summary,
                portfolio.baseCurrency,
                year,
                new Date(),
              )
            ).toString();

      // Indonesian final-tax is flat, withheld-at-source: 0.1% of SALE PROCEEDS + 10% of
      // dividend/coupon GROSS. No Sparerpauschbetrag, no harvesting, no realized-gain
      // computation — so the entire German-shape response (`allowanceUsage`,
      // `harvestSuggestions`, `tfRatesByInstrument`, `holderDistribution`,
      // `carryForwardApplied`) is replaced by a single `indonesianFinalTax` block sourced
      // from the same trade log the German branch uses. Computed BEFORE the German
      // forecast / tf-rates / allowance work below — those are wasted cycles for ID.
      if (regime === "ID") {
        const idTax = computeIndonesianFinalTaxFromTradeLog({
          tradeLog,
          coreTxns,
          year,
          metaById,
          displayCurrency: portfolio.baseCurrency,
          fxRates: makeIdFxRateMap(fxRates),
        });
        request.timingName = "GET /portfolios/:id/tax";
        request.timingMeta = {
          portfolioId,
          year,
          regime,
        };
        return {
          year,
          regime: "ID" as const,
          currency: portfolio.baseCurrency,
          indonesianFinalTax: idTax,
          harvestSuggestions: [],
        };
      }

      // DE path — all the FSA/Harvest/Tf computations need `portfolio.taxAllowanceAnnual`
      // to be set (guarded by the regime==="DE" 422 above).
      const allowanceAnnual = portfolio.taxAllowanceAnnual as string;
      const taxRate = holderProfile?.capitalGainsTaxRate ?? "0.25";

      const usage = allowanceUsageYTD({
        tradeLog,
        tfRates,
        allowanceAnnual,
        taxRate,
        year,
        forecastIncomeRestOfYear,
        assetClasses,
        lossCarryForward: lossCarryForwardInput,
      });
      const suggestions = harvestSuggestions({
        tradeLog,
        tfRates,
        allowanceAnnual,
        taxRate,
        year,
        usage,
      });

      return {
        year,
        regime: "DE" as const,
        currency: portfolio.baseCurrency,
        allowanceUsage: usage,
        harvestSuggestions: suggestions.map((s) => ({
          ...s,
          instrument: metaById.get(s.instrumentId) ?? null,
        })),
        tfRatesByInstrument: tfRates,
        carryForwardApplied,
        holderDistribution: {
          holderAllowanceCap: holderAllowanceCap.toFixed(2),
          totalAllocated: totalAllocatedForHolder.toFixed(2),
          remainingToDistribute: remainingToDistribute.toFixed(2),
          overAllocated,
        },
      };
    },
  );

  /**
   * GET /networth/tax
   * Aggregated tax summary across all of the user's portfolios (or filtered by holderId).
   * - DE: returns one entry per holder that has at least one depot with a `taxAllowanceAnnual`
   *   (FSA allocation) — same as before.
   * - ID: returns one entry per holder that has any portfolio. ID has no Sparerpauschbetrag
   *   concept, so holders without FSA allocation still surface — the `indonesianFinalTax`
   *   payload is the source of truth for the report (W2 fix: previously ID users with no
   *   FSA allocation got an empty array and the tax detail section rendered zero/unavailable).
   */
  app.get<{ Querystring: { year?: string; holderId?: string } }>(
    "/networth/tax",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const { holderId: filterHolderId } = request.query;
      const year = request.query.year
        ? parseInt(request.query.year, 10)
        : new Date().getUTCFullYear();

      const [u] = await app.db
        .select({ displayCurrency: users.displayCurrency })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const display = u?.displayCurrency ?? "IDR";

      // Tax regime is per-user; default DE. ID users may have NO FSA allocation, so the
      // holder-include filter below branches on regime.
      const [prefs] = await app.db
        .select({ taxRegime: userPreferences.taxRegime })
        .from(userPreferences)
        .where(eq(userPreferences.userId, id))
        .limit(1);
      const regime: "DE" | "ID" = prefs?.taxRegime === "ID" ? "ID" : "DE";

      if (filterHolderId != null) {
        const [holder] = await app.db
          .select()
          .from(accountHolders)
          .where(and(eq(accountHolders.id, filterHolderId), eq(accountHolders.userId, id)))
          .limit(1);
        if (!holder) return reply.status(404).send({ error: "holder_not_found" });
      }

      const holderRows = await app.db
        .select()
        .from(accountHolders)
        .where(
          filterHolderId != null
            ? and(eq(accountHolders.userId, id), eq(accountHolders.id, filterHolderId))
            : eq(accountHolders.userId, id),
        );

      // For ID regime, surface portfolios not yet linked to any account holder under a
      // synthetic "Unallocated" entry — they have ID tax obligations regardless of holder
      // membership, and excluding them was the W2 silent-zero bug. (DE regime: portfolios
      // without a holder can't carry an FSA allocation, so this surface is empty by design.)
      const unallocatedPortfolios =
        regime === "ID" && filterHolderId == null
          ? await app.db
              .select({
                id: portfolios.id,
                cashCounted: portfolios.cashCounted,
                taxAllowanceAnnual: portfolios.taxAllowanceAnnual,
              })
              .from(portfolios)
              .where(and(eq(portfolios.userId, id), isNull(portfolios.accountHolderId)))
          : [];
      const syntheticUnallocatedHolder =
        unallocatedPortfolios.length > 0
          ? {
              id: "__unallocated__",
              userId: id,
              name: "Unallocated",
              taxAllowanceAnnual: null,
              capitalGainsTaxRate: null,
              churchTax: null,
              taxResidence: null,
              createdAt: new Date(),
            }
          : null;

      type EffectiveHolder =
        (typeof holderRows)[number] | NonNullable<typeof syntheticUnallocatedHolder>;
      const effectiveHolders: EffectiveHolder[] = syntheticUnallocatedHolder
        ? [syntheticUnallocatedHolder, ...holderRows]
        : [...holderRows];

      const perHolderResults = await mapPool(effectiveHolders, 2, async (holder) => {
        const isSynthetic = holder.id === "__unallocated__";
        const pfs = isSynthetic
          ? unallocatedPortfolios
          : await app.db
              .select({
                id: portfolios.id,
                cashCounted: portfolios.cashCounted,
                taxAllowanceAnnual: portfolios.taxAllowanceAnnual,
              })
              .from(portfolios)
              .where(and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holder.id)));

        if (pfs.length === 0) return null;

        const totalAllocated = pfs.reduce(
          (sum, p) => sum.plus(toDecimalSafe(p.taxAllowanceAnnual)),
          new Decimal(0),
        );
        // Under DE, holders without any FSA allocation are filtered — the German summary
        // is meaningless without an allowance to allocate. Under ID, every holder surfaces
        // so the ID payload is reachable regardless of FSA configuration.
        if (regime === "DE" && totalAllocated.isZero()) return null;

        const now = new Date();
        const perPortfolio = await mapPool(pfs, PORTFOLIO_VALUATION_CONCURRENCY, async (p) => {
          const {
            coreTxns,
            prices,
            metaById,
            summary,
            fxRates: pFxRates,
          } = await loadValuation(app, p.id, display, undefined, p.cashCounted);
          const log = await buildTradeLog(
            app,
            coreTxns,
            prices,
            display,
            "fifo",
            undefined,
            metaById,
          );
          // Skip restOfYearForecastGross under ID — the forecast is gross-income-only
          // (used by the German branch's harvestSuggestion / FSP path) and the ID
          // branch doesn't read `totalForecastGross`. Saves a per-portfolio query.
          const pfForecast =
            regime === "ID"
              ? Promise.resolve({ toString: () => "0" } as { toString: () => string })
              : restOfYearForecastGross(app, coreTxns, summary, display, year, now);
          const forecast = await pfForecast;
          return {
            log,
            metaById,
            coreTxns,
            forecast: Number(forecast.toString()),
            rateByCcy: pFxRates as Record<string, string>,
          };
        });
        const logs: TradeLog[] = perPortfolio.map((r) => r.log);
        const meta = new Map<string, InstrumentMeta>();
        let totalForecastGross = 0;
        if (regime !== "ID") {
          for (const { metaById, forecast } of perPortfolio) {
            for (const [k, v] of metaById) meta.set(k, v);
            totalForecastGross += forecast;
          }
        } else {
          for (const { metaById } of perPortfolio) {
            for (const [k, v] of metaById) meta.set(k, v);
          }
        }
        const mergedLog = mergeTradeLogs(logs, display, "fifo");

        // Indonesian final-tax (flat, withheld-at-source): 0.1% of SALE PROCEEDS + 10% of
        // dividend/coupon GROSS. No Sparerpauschbetrag / harvesting / realized-gain
        // computation. Computed against the holder's MERGED trade log across all their
        // portfolios, so the per-holder ID total includes proceeds from every depot.
        // (W2: previously /networth/tax filtered out holders with no FSA allocation,
        // which silently zeroed the ID payload for ID users — now it surfaces directly.)
        if (regime === "ID") {
          const allCoreTxns = perPortfolio.flatMap((p) => p.coreTxns);
          // The per-portfolio loadValuation returned fxRates for each portfolio's display
          // (its baseCurrency), not the networth-level `display`. Re-derive a display→
          // native→display map that covers every distinct native currency across all the
          // holder's portfolios. (mergeTradeLogs already folded the legs into display.)
          const displayRates = new Map<string, number>();
          for (const { rateByCcy } of perPortfolio) {
            for (const [k, v] of Object.entries(rateByCcy ?? {})) displayRates.set(k, Number(v));
          }
          const idTax = computeIndonesianFinalTaxFromTradeLog({
            tradeLog: mergedLog,
            coreTxns: allCoreTxns,
            year,
            metaById: meta,
            displayCurrency: display,
            fxRates: displayRates,
          });
          return {
            holder: {
              id: holder.id,
              name: holder.name,
              taxAllowanceAnnual: holder.taxAllowanceAnnual,
              capitalGainsTaxRate: holder.capitalGainsTaxRate,
              churchTax: holder.churchTax,
              taxResidence: holder.taxResidence,
            },
            year,
            regime: "ID" as const,
            currency: display,
            indonesianFinalTax: idTax,
            harvestSuggestions: [],
          };
        }

        const tfRates = buildTfRates(mergedLog.trades, meta);
        const assetClasses = Object.fromEntries(
          [...meta.entries()].map(([iid, m]) => [iid, m.assetClass]),
        );
        const taxRate = holder.capitalGainsTaxRate ?? "0.25";
        const forecastIncomeRestOfYear =
          totalForecastGross > 0 ? totalForecastGross.toFixed(2) : "0";
        const lossCarryForward = await lossCarryForwardFor(app, holder.id, year);

        const holderAllowanceCap = new Decimal(holder.taxAllowanceAnnual ?? 1000);
        const remainingToDistribute = Decimal.max(
          new Decimal(0),
          holderAllowanceCap.minus(totalAllocated),
        );
        const overAllocated = totalAllocated.gt(holderAllowanceCap);

        const allowanceAnnual = holderAllowanceCap.toFixed(2);

        const usage = allowanceUsageYTD({
          tradeLog: mergedLog,
          tfRates,
          allowanceAnnual,
          taxRate,
          year,
          forecastIncomeRestOfYear,
          assetClasses,
          lossCarryForward,
        });
        const suggestions = harvestSuggestions({
          tradeLog: mergedLog,
          tfRates,
          allowanceAnnual,
          taxRate,
          year,
          usage,
        });

        return {
          holder: {
            id: holder.id,
            name: holder.name,
            taxAllowanceAnnual: holder.taxAllowanceAnnual,
            capitalGainsTaxRate: holder.capitalGainsTaxRate,
            churchTax: holder.churchTax,
            taxResidence: holder.taxResidence,
          },
          year,
          currency: display,
          allowanceUsage: usage,
          harvestSuggestions: suggestions.map((s) => ({
            ...s,
            instrument: meta.get(s.instrumentId) ?? null,
          })),
          tfRatesByInstrument: tfRates,
          carryForwardApplied: true,
          distribution: {
            holderAllowanceCap: holderAllowanceCap.toFixed(2),
            totalAllocated: totalAllocated.toFixed(2),
            remainingToDistribute: remainingToDistribute.toFixed(2),
            overAllocated,
          },
        };
      });
      const result = perHolderResults.filter((r): r is NonNullable<typeof r> => r != null);

      request.timingName = "GET /networth/tax";
      request.timingMeta = {
        holderCount: holderRows.length,
        year,
      };
      return result;
    },
  );
}
