import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { allocationTargets } from "@portfolio/db";
import {
  type CoreTransaction,
  type TradeMethod,
  type CostBasisMode,
  type TradeLog,
  type CorporateAction,
  type DriftRow,
  computeTrades,
  rebalancingDrift,
} from "@portfolio/core";
import { getFxRates, makeFxRateFn } from "../../../services/fx.js";
import type { InstrumentMeta } from "../../../services/valuation.js";
import { corporateActionsFor } from "./helpers.js";

export async function buildTradeLog(
  app: FastifyInstance,
  coreTxns: CoreTransaction[],
  prices: Record<string, { price: string; currency: string }>,
  target: string,
  method: TradeMethod,
  costBasisMode: CostBasisMode | undefined,
  instrumentsMeta?: Map<string, InstrumentMeta>,
  existingCorporateActions?: CorporateAction[],
  existingFxRates?: Record<string, string>,
): Promise<TradeLog> {
  const currencies = new Set<string>(coreTxns.map((t) => t.currency));
  for (const p of Object.values(prices)) currencies.add(p.currency);
  const fx = makeFxRateFn(
    existingFxRates ?? (await getFxRates(app.db, [...currencies], target)),
    target,
  );
  const cas =
    existingCorporateActions ??
    (await corporateActionsFor(
      app,
      coreTxns.map((t) => t.instrumentId),
    ));
  return computeTrades({
    transactions: coreTxns,
    corporateActions: cas,
    prices,
    displayCurrency: target,
    fx,
    method,
    costBasisMode,
    instruments: instrumentsMeta,
  });
}

export function attachInstruments(log: TradeLog, meta: Map<string, InstrumentMeta>) {
  return {
    ...log,
    trades: log.trades.map((t) => ({
      ...t,
      instrument: meta.get(t.instrumentId) ?? null,
    })),
  };
}

export async function loadDrift(
  app: FastifyInstance,
  userId: string,
  portfolioId: string | null,
  allocation: {
    byAssetClass: { key: string; value: string; pct: number }[];
    byCurrency: { key: string; value: string; pct: number }[];
    byRegion: { key: string; value: string; pct: number }[];
    bySector: { key: string; value: string; pct: number }[];
  },
): Promise<Record<string, DriftRow[]>> {
  const rows = await app.db
    .select()
    .from(allocationTargets)
    .where(
      and(
        eq(allocationTargets.userId, userId),
        portfolioId
          ? eq(allocationTargets.portfolioId, portfolioId)
          : isNull(allocationTargets.portfolioId),
      ),
    );

  if (rows.length === 0) return {};

  const byDimension = new Map<string, { key: string; targetPct: number }[]>();
  for (const r of rows) {
    const existing = byDimension.get(r.dimension) ?? [];
    existing.push({ key: r.targetKey, targetPct: Number(r.targetPct) });
    byDimension.set(r.dimension, existing);
  }

  const DIMENSION_SLICES: Record<string, typeof allocation.byAssetClass> = {
    asset_class: allocation.byAssetClass,
    currency: allocation.byCurrency,
    region: allocation.byRegion,
    sector: allocation.bySector,
  };

  const result: Record<string, DriftRow[]> = {};
  for (const [dimension, targets] of byDimension) {
    const slices = DIMENSION_SLICES[dimension];
    if (!slices) continue;
    const drift = rebalancingDrift(slices, targets);
    if (drift.length > 0) result[dimension] = drift;
  }
  return result;
}
