import { inArray, sql } from "drizzle-orm";
import { prices } from "@portfolio/db";
import type { DB } from "../db/client.js";

/** How many recent daily closes to send per instrument for the mobile sparkline. */
const SPARK_POINTS = 30;

/**
 * Load a compact recent-close series per instrument for the mobile holdings sparkline.
 *
 * One grouped query over `prices` using "last N rows per instrument" via a `row_number()`
 * window — deliberately NOT a calendar cutoff (`date >= today - Nd`), which would return
 * nothing for an instrument whose closes are stale and shrink around holidays. Instruments
 * with fewer than 2 stored closes are omitted (the row hides its sparkline).
 *
 * Returns each series oldest→newest as plain numbers (`Number(close)`) — purely visual, so
 * no decimal precision is needed.
 */
export async function loadSparklines(
  db: DB,
  instrumentIds: string[],
): Promise<Map<string, number[]>> {
  const ids = [...new Set(instrumentIds)];
  if (ids.length === 0) return new Map();

  // Rank each instrument's closes newest-first, then keep the newest `SPARK_POINTS`.
  const ranked = db
    .select({
      instrumentId: prices.instrumentId,
      date: prices.date,
      close: prices.close,
      rn: sql<number>`row_number() over (partition by ${prices.instrumentId} order by ${prices.date} desc)`.as(
        "rn",
      ),
    })
    .from(prices)
    .where(inArray(prices.instrumentId, ids))
    .as("ranked");

  const rows = await db
    .select({
      instrumentId: ranked.instrumentId,
      close: ranked.close,
    })
    .from(ranked)
    .where(sql`${ranked.rn} <= ${SPARK_POINTS}`)
    // Ascending date → oldest→newest within the kept window.
    .orderBy(ranked.instrumentId, ranked.date);

  const byInstrument = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byInstrument.get(r.instrumentId) ?? [];
    arr.push(Number(r.close));
    byInstrument.set(r.instrumentId, arr);
  }
  // Drop series too short to draw a line.
  for (const [id, series] of byInstrument) {
    if (series.length < 2) byInstrument.delete(id);
  }
  return byInstrument;
}
