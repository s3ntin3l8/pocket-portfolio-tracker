import type { FastifyBaseLogger } from "fastify";
import { estimateVorabRows, type CoreTransaction, type CorporateAction } from "@portfolio/core";
import type { DB } from "../db/client.js";
import type { InstrumentMeta } from "./valuation.js";
import { getPricesOn, priceKey, type PriceOn } from "./price-history.js";

/** Asset classes that accrue a Vorabpauschale (equity/mixed funds and ETFs). */
const FUND_CLASSES = new Set(["etf", "mutual_fund"]);

/** What a set of transactions needs priced: fund ids plus the first year they touch. */
export interface VorabNeeds {
  fundIds: string[];
  firstYear: number;
}

/** Phase (a): the fund ids (etf/mutual_fund) in `coreTxns` and their earliest year, or null. */
export function collectVorabNeeds(
  coreTxns: CoreTransaction[],
  metaById: Map<string, InstrumentMeta>,
): VorabNeeds | null {
  const fundIds = new Set<string>();
  let firstYear = Infinity;
  for (const t of coreTxns) {
    if (!t.instrumentId || !FUND_CLASSES.has(metaById.get(t.instrumentId)?.assetClass ?? "")) {
      continue;
    }
    fundIds.add(t.instrumentId);
    firstYear = Math.min(firstYear, t.executedAt.getUTCFullYear());
  }
  return fundIds.size === 0 ? null : { fundIds: [...fundIds], firstYear };
}

/** 1 Jan / 31 Dec of every finished year from `firstYear` (no estimates before 2023). */
export function vorabBoundaryDates(firstYear: number, now: Date): string[] {
  const dates: string[] = [];
  for (let y = Math.max(firstYear, 2023); y < now.getUTCFullYear(); y++) {
    dates.push(`${y}-01-01`, `${y}-12-31`);
  }
  return dates;
}

export type VorabPriceLookup = (instrumentId: string, date: string) => PriceOn | null;

/**
 * Batch the boundary-price lookup for several needs (e.g. every portfolio of a request) into
 * ONE `getPricesOn` query over the union of fund ids and years. The returned lookup is safe
 * to share: a (id, date) pair nobody asked for is simply a miss.
 */
export async function loadVorabPrices(
  db: DB,
  needs: (VorabNeeds | null)[],
  now: Date = new Date(),
): Promise<VorabPriceLookup> {
  const present = needs.filter((n): n is VorabNeeds => n !== null);
  if (present.length === 0) return () => null;
  const fundIds = [...new Set(present.flatMap((n) => n.fundIds))];
  const dates = vorabBoundaryDates(Math.min(...present.map((n) => n.firstYear)), now);
  if (dates.length === 0) return () => null;
  const found = await getPricesOn(db, fundIds, dates);
  return (id, date) => found.get(priceKey(id, date)) ?? null;
}

/** Phase (b): estimate rows from already-loaded boundary prices. DE regime only. */
export function estimateVorabFromPrices(
  coreTxns: CoreTransaction[],
  corporateActions: CorporateAction[],
  metaById: Map<string, InstrumentMeta>,
  priceOn: VorabPriceLookup,
  now: Date = new Date(),
  log?: FastifyBaseLogger,
): CoreTransaction[] {
  if (!collectVorabNeeds(coreTxns, metaById)) return [];
  return estimateVorabRows({
    transactions: coreTxns,
    corporateActions,
    isFund: (id) => FUND_CLASSES.has(metaById.get(id)?.assetClass ?? ""),
    priceOn,
    now,
    warn: (msg) => log?.info(msg),
  });
}

/**
 * Derived (never persisted) Vorabpauschale rows for fund holdings the broker booked none
 * for — see `estimateVorabRows` in `@portfolio/core` for the §18 InvStG rules. Loads only
 * the year-boundary closes the estimate needs; returns `[]` without touching the DB when
 * there is no fund in `coreTxns`. German regime only — the caller gates on that. Callers
 * with several portfolios should use {@link loadVorabPrices} once and
 * {@link estimateVorabFromPrices} per portfolio instead.
 */
export async function loadEstimatedVorabRows(
  db: DB,
  coreTxns: CoreTransaction[],
  corporateActions: CorporateAction[],
  metaById: Map<string, InstrumentMeta>,
  now: Date = new Date(),
  log?: FastifyBaseLogger,
): Promise<CoreTransaction[]> {
  const needs = collectVorabNeeds(coreTxns, metaById);
  if (!needs) return [];
  const priceOn = await loadVorabPrices(db, [needs], now);
  return estimateVorabFromPrices(coreTxns, corporateActions, metaById, priceOn, now, log);
}
