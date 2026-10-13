import type { FastifyBaseLogger } from "fastify";
import { estimateVorabRows, type CoreTransaction, type CorporateAction } from "@portfolio/core";
import type { DB } from "../db/client.js";
import type { InstrumentMeta } from "./valuation.js";
import { getPricesOn, priceKey } from "./price-history.js";

/** Asset classes that accrue a Vorabpauschale (equity/mixed funds and ETFs). */
const FUND_CLASSES = new Set(["etf", "mutual_fund"]);

/**
 * Derived (never persisted) Vorabpauschale rows for fund holdings the broker booked none
 * for — see `estimateVorabRows` in `@portfolio/core` for the §18 InvStG rules. Loads only
 * the year-boundary closes the estimate needs; returns `[]` without touching the DB when
 * there is no fund in `coreTxns`. German regime only — the caller gates on that.
 */
export async function loadEstimatedVorabRows(
  db: DB,
  coreTxns: CoreTransaction[],
  corporateActions: CorporateAction[],
  metaById: Map<string, InstrumentMeta>,
  now: Date = new Date(),
  log?: FastifyBaseLogger,
): Promise<CoreTransaction[]> {
  const isFund = (id: string) => FUND_CLASSES.has(metaById.get(id)?.assetClass ?? "");
  const fundIds = [
    ...new Set(
      coreTxns.flatMap((t) => (t.instrumentId && isFund(t.instrumentId) ? [t.instrumentId] : [])),
    ),
  ];
  if (fundIds.length === 0) return [];

  const firstYear = Math.min(
    ...coreTxns
      .filter((t) => t.instrumentId && isFund(t.instrumentId))
      .map((t) => t.executedAt.getUTCFullYear()),
  );
  const dates: string[] = [];
  for (let y = Math.max(firstYear, 2023); y < now.getUTCFullYear(); y++) {
    dates.push(`${y}-01-01`, `${y}-12-31`);
  }
  if (dates.length === 0) return [];

  const found = await getPricesOn(db, fundIds, dates);
  return estimateVorabRows({
    transactions: coreTxns,
    corporateActions,
    isFund,
    priceOn: (id, date) => found.get(priceKey(id, date)) ?? null,
    now,
    warn: (msg) => log?.info(msg),
  });
}
