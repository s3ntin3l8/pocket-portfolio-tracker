import { inArray, isNotNull } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { computeHoldings, type CorporateAction } from "@portfolio/core";
import { corporateActions, instruments, transactions } from "@portfolio/db";
import type { InstrumentRef, MarketDataService } from "@portfolio/market-data";
import type { DB } from "../db/client.js";
import { dropStaleQuotes, upsertLastPrices } from "./price-cache.js";
import { isMarketOpen } from "./market-hours.js";
import { toCoreTxns } from "./tx-core.js";

/**
 * Instrument ids with a non-zero *current* position in at least one portfolio (audit D2).
 * Derived with the same `computeHoldings` walk every other valuation uses (so splits,
 * transfers and bonus receipts count exactly as they do elsewhere); draft/archived rows
 * are ignored by `toCoreTxns`. A fully-sold or never-held instrument is NOT in the set.
 * If a portfolio's walk throws (e.g. mixed-currency cost basis), its instruments are
 * conservatively treated as held rather than silently dropping their quotes.
 */
export async function currentlyHeldInstrumentIds(db: DB): Promise<string[]> {
  const rows = await db.select().from(transactions).where(isNotNull(transactions.instrumentId));
  if (rows.length === 0) return [];
  const byPortfolio = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byPortfolio.get(r.portfolioId) ?? [];
    list.push(r);
    byPortfolio.set(r.portfolioId, list);
  }
  const candidateIds = [...new Set(rows.map((r) => r.instrumentId!))];
  const caRows = await db
    .select()
    .from(corporateActions)
    .where(inArray(corporateActions.instrumentId, candidateIds));

  const held = new Set<string>();
  for (const [portfolioId, pfRows] of byPortfolio) {
    const cas: CorporateAction[] = caRows
      .filter((c) => c.portfolioId === null || c.portfolioId === portfolioId)
      .map((c) => ({
        instrumentId: c.instrumentId,
        type: c.type,
        ratio: c.ratio,
        exDate: new Date(c.exDate),
        portfolioId: c.portfolioId,
        targetInstrumentId: c.targetInstrumentId ?? undefined,
        ratioTo: c.ratioTo ?? undefined,
        taxableMarketValue: c.taxableMarketValue ?? undefined,
      }));
    try {
      for (const h of computeHoldings(toCoreTxns(pfRows), cas)) {
        if (!new Decimal(h.quantity).isZero()) held.add(h.instrumentId);
      }
    } catch {
      for (const r of pfRows) if (r.instrumentId) held.add(r.instrumentId);
    }
  }
  return [...held];
}

/**
 * Proactively refresh cached prices for every currently-held instrument whose market is
 * open, writing fresh quotes to last_prices. Held = non-zero current position (see
 * {@link currentlyHeldInstrumentIds}), not merely "ever referenced by a transaction".
 * Returns how many instruments were refreshed.
 */
export async function refreshHeldPrices(
  db: DB,
  service: MarketDataService,
  now: Date = new Date(),
): Promise<number> {
  const heldIds = await currentlyHeldInstrumentIds(db);
  if (heldIds.length === 0) return 0;

  const rows = await db.select().from(instruments).where(inArray(instruments.id, heldIds));
  const open = rows.filter((i) => isMarketOpen(i.market, now));
  if (open.length === 0) return 0;

  const fetched = await service.getQuotes(
    open.map((i) => ({
      id: i.id,
      ref: {
        symbol: i.symbol,
        market: i.market,
        assetClass: i.assetClass,
        currency: i.currency,
        // Pass the ISIN so providers can use it for cross-listing disambiguation when the
        // stored symbol resolves to a wrong listing (Yahoo's resolveIsinSymbol fallback).
        isin: i.isin ?? undefined,
      } satisfies InstrumentRef,
    })),
  );
  // Same stale-quote gate as getCachedQuotes (audit B13): last_prices stamps `asOf` with
  // the fetch time, so writing a long-dead quote here would serve it as fresh.
  const quotes = dropStaleQuotes(fetched, now);
  await upsertLastPrices(db, quotes, now);
  return Object.keys(quotes).length;
}
