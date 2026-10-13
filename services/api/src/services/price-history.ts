import { and, desc, gte, inArray, lte } from "drizzle-orm";
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
 * figure). One `DISTINCT ON` query per date; misses are simply absent from the map.
 */
export async function getPricesOn(
  db: DB,
  instrumentIds: string[],
  dates: string[],
  lookbackDays = 5,
): Promise<Map<string, PriceOn>> {
  const out = new Map<string, PriceOn>();
  if (instrumentIds.length === 0) return out;
  for (const date of new Set(dates)) {
    const rows = await db
      .selectDistinctOn([prices.instrumentId])
      .from(prices)
      .where(
        and(
          inArray(prices.instrumentId, instrumentIds),
          lte(prices.date, date),
          gte(prices.date, minusDays(date, lookbackDays)),
        ),
      )
      .orderBy(prices.instrumentId, desc(prices.date));
    for (const r of rows) {
      out.set(priceKey(r.instrumentId, date), { close: r.close, currency: r.currency });
    }
  }
  return out;
}
