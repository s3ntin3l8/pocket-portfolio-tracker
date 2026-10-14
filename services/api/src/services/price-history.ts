import { and, desc, gte, inArray, lte, or } from "drizzle-orm";
import { prices } from "@portfolio/db";
import type { DB } from "../db/client.js";

/** A stored close (raw, NOT split-adjusted) and the currency it is quoted in. */
export interface PriceOn {
  close: string;
  currency: string;
}

/** `${instrumentId}|${YYYY-MM-DD}` — key into {@link getPricesOn}'s result. */
export const priceKey = (instrumentId: string, date: string) => `${instrumentId}|${date}`;

function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The latest stored close on or before each requested date, per instrument, looking back at
 * most `lookbackDays` (so a long price gap is a miss, not a stale number carried into a tax
 * figure). One query for all dates (an OR of per-date windows, each at most `lookbackDays`+1
 * rows per instrument), reduced per (instrument, date) in JS; misses are simply absent.
 */
export async function getPricesOn(
  db: DB,
  instrumentIds: string[],
  dates: string[],
  lookbackDays = 5,
): Promise<Map<string, PriceOn>> {
  const out = new Map<string, PriceOn>();
  const wanted = [...new Set(dates)];
  if (instrumentIds.length === 0 || wanted.length === 0) return out;
  const windows = wanted.map((date) => ({ date, from: minusDays(date, lookbackDays) }));
  const rows = await db
    .select({
      instrumentId: prices.instrumentId,
      date: prices.date,
      close: prices.close,
      currency: prices.currency,
    })
    .from(prices)
    .where(
      and(
        inArray(prices.instrumentId, instrumentIds),
        or(...windows.map((w) => and(gte(prices.date, w.from), lte(prices.date, w.date)))),
      ),
    )
    .orderBy(prices.instrumentId, desc(prices.date));
  for (const r of rows) {
    for (const w of windows) {
      if (r.date > w.date || r.date < w.from) continue;
      const key = priceKey(r.instrumentId, w.date);
      // Rows arrive newest-first per instrument, so the first hit is the latest close.
      if (!out.has(key)) out.set(key, { close: r.close, currency: r.currency });
    }
  }
  return out;
}
