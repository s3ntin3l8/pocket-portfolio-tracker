import { sql } from "drizzle-orm";
import { prices } from "@portfolio/db";
import type { DB } from "../../db/client.js";
import { chunk } from "../../lib/chunk.js";

/**
 * Upsert price rows with chunked multi-row statements (~500 rows each) instead of one
 * round-trip per row (audit D6). `rows` must not repeat an (instrumentId, date) pair —
 * callers build them from per-instrument `Map<date, ...>`s, which guarantees that.
 */
export async function upsertPriceRows(
  db: DB,
  rows: { instrumentId: string; date: string; close: string; currency: string }[],
): Promise<void> {
  for (const part of chunk(rows)) {
    await db
      .insert(prices)
      .values(part)
      .onConflictDoUpdate({
        target: [prices.instrumentId, prices.date],
        set: { close: sql`excluded.close`, currency: sql`excluded.currency` },
      });
  }
}
