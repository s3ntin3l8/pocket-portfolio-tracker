import { eq, and, inArray, isNull, or, sql } from "drizzle-orm";
import { corporateActions, instruments, portfolios, prices, transactions } from "@portfolio/db";
import { DEAD_FEED_MISS_THRESHOLD, MAX_PRICE_CARRY_FORWARD_DAYS, toDateKey } from "@portfolio/core";
import type { DB } from "../../db/client.js";

/**
 * Preamble shared by `backfillPortfolioHistory` and `computeBackfillSnapshots`: loads the
 * portfolio's transactions/held instruments/corporate actions and derives the
 * inception-or-`fromDate` window. Returns `null` when there is nothing to do (no
 * transactions at all, or the derived window starts after today) — callers return the
 * empty `BackfillResult` in that case.
 */
export async function loadBackfillContext(
  db: DB,
  portfolioId: string,
  opts: { fromDate?: string } = {},
) {
  const txRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolioId));

  if (txRows.length === 0) return null;

  const [pf] = await db
    .select({ cashCounted: portfolios.cashCounted })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1);
  const cashCounted = pf?.cashCounted ?? true;

  const inceptionMs = Math.min(...txRows.map((r) => r.executedAt.getTime()));
  const inceptionDate = toDateKey(new Date(inceptionMs));
  const startDate = opts.fromDate && opts.fromDate > inceptionDate ? opts.fromDate : inceptionDate;
  const today = toDateKey(new Date());

  if (startDate > today) return null;

  const instrIds = [
    ...new Set(txRows.map((r) => r.instrumentId).filter((x): x is string => x !== null)),
  ];
  const instrRows = instrIds.length
    ? await db.select().from(instruments).where(inArray(instruments.id, instrIds))
    : [];
  const instrById = new Map(instrRows.map((i) => [i.id, i]));

  const caRows = instrIds.length
    ? await db
        .select()
        .from(corporateActions)
        .where(
          and(
            inArray(corporateActions.instrumentId, instrIds),
            or(isNull(corporateActions.portfolioId), eq(corporateActions.portfolioId, portfolioId)),
          ),
        )
    : [];
  const coreCas = caRows.map((r) => ({
    instrumentId: r.instrumentId,
    type: r.type as "split" | "bonus" | "rights",
    ratio: r.ratio,
    exDate: new Date(r.exDate),
    portfolioId: r.portfolioId,
    targetInstrumentId: r.targetInstrumentId ?? undefined,
    ratioTo: r.ratioTo ?? undefined,
    taxableMarketValue: r.taxableMarketValue ?? undefined,
  }));

  return {
    portfolioId,
    txRows,
    cashCounted,
    startDate,
    today,
    instrIds,
    instrRows,
    instrById,
    coreCas,
  };
}

export type BackfillContext = NonNullable<Awaited<ReturnType<typeof loadBackfillContext>>>;

/**
 * The instrument's own first-held date (YYYY-MM-DD), seeded from ITS OWN transactions —
 * not an arbitrary row from elsewhere in the portfolio. (Seeding a reduce with an
 * unrelated, potentially earlier date meant the reduce could never find anything
 * "smaller" and got stuck at that wrong seed — inflating the fetch window to the whole
 * portfolio's earliest date for every instrument, not just the one actually held that
 * early.) Returns `null` if the instrument has no matching rows.
 */
export function firstHeldDateFrom(
  rows: { instrumentId: string | null; executedAt: Date }[],
  instrumentId: string,
): string | null {
  const instrRows = rows.filter((r) => r.instrumentId === instrumentId);
  if (instrRows.length === 0) return null;
  const firstHeld = instrRows.reduce(
    (min, r) => (r.executedAt < min ? r.executedAt : min),
    instrRows[0]!.executedAt,
  );
  return toDateKey(firstHeld);
}

/**
 * DB-querying variant of `firstHeldDateFrom` for a caller with no `txRows` already in
 * memory (the per-instrument sub-job worker). Scoped to BOTH `portfolioId` AND
 * `instrumentId` — querying by `instrumentId` alone would answer "when was this
 * instrument first held by ANY portfolio", not this one, misreporting truncation for an
 * instrument shared across portfolios with different first-held dates.
 */
export async function firstHeldDateFor(
  db: DB,
  portfolioId: string,
  instrumentId: string,
): Promise<string | null> {
  const rows = await db
    .select({ executedAt: transactions.executedAt })
    .from(transactions)
    .where(
      and(eq(transactions.portfolioId, portfolioId), eq(transactions.instrumentId, instrumentId)),
    );
  if (rows.length === 0) return null;
  const firstHeld = rows.reduce(
    (min, r) => (r.executedAt < min ? r.executedAt : min),
    rows[0]!.executedAt,
  );
  return toDateKey(firstHeld);
}

/**
 * A bond with a positive manual price: the manual price is the only meaningful data
 * point for it. Both price-writing paths (the inline fetch loop and
 * `fetchInstrumentPrices`) skip writing generated par rows for one, and
 * `computeBackfillSnapshots` skips reading whatever par rows already exist for one —
 * otherwise stale rows from before the manual price was set would silently override it.
 */
export function isManualPriceBond(instr: {
  assetClass: string;
  manualPrice: string | null;
}): boolean {
  return instr.assetClass === "bond" && !!instr.manualPrice && Number(instr.manualPrice) > 0;
}

/** The later (max) of two YYYY-MM-DD date keys — plain lexicographic compare works since
 *  both are always zero-padded ISO dates. */
export function laterDateKey(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * After a fetch of `fetchedDates` (all >= `fetchFrom`), does the instrument's price
 * history still have a hole longer than the carry-forward window — between prices, or
 * from the last price to `today`? The series graded is what the backfill will actually
 * value from: the rows already stored from `fetchFrom` on, unioned with this run's
 * candles, anchored on the newest stored price before `fetchFrom` (so a heal that only
 * returns the far side of a hole is not mistaken for a contiguous series, and a
 * transiently short fetch on an already-contiguous series is not a miss). A feed that
 * keeps leaving such a hole is a miss for the dead-feed cooldown, even though it
 * returned candles.
 */
export async function priceGapRemains(
  db: DB,
  instrumentId: string,
  fetchFrom: string,
  fetchedDates: string[],
  today: string,
): Promise<boolean> {
  // Graded in SQL (one lag() pass) rather than loading every stored date: a from-inception
  // heal of a long-lived instrument would otherwise read thousands of rows per run.
  // Same rule as `findGaps` — interior hole, or last price to `today` — over the stored
  // window, the run's candle dates and the anchor; nothing before the first date.
  const fetchedCsv = fetchedDates.join(",");
  const result = await db.execute<{ gap: boolean }>(sql`
    with d as (
      select ${prices.date} as date from ${prices}
        where ${prices.instrumentId} = ${instrumentId} and ${prices.date} >= ${fetchFrom}
      union
      select max(${prices.date}) from ${prices}
        where ${prices.instrumentId} = ${instrumentId} and ${prices.date} < ${fetchFrom}
      union
      select unnest(string_to_array(nullif(${fetchedCsv}, ''), ','))::date
    ), s as (
      select date, lag(date) over (order by date) as prev from d where date is not null
    )
    select (
      exists (select 1 from s where prev is not null
                and (date - prev) > ${MAX_PRICE_CARRY_FORWARD_DAYS}::int)
      or coalesce(${today}::date - (select max(date) from s) > ${MAX_PRICE_CARRY_FORWARD_DAYS}::int, false)
    ) as gap
  `);
  const rows = Array.isArray(result)
    ? (result as { gap: boolean }[])
    : ((result as unknown as { rows: { gap: boolean }[] }).rows ?? []);
  return rows[0]?.gap === true;
}

/**
 * #737 — a feed that has failed `DEAD_FEED_MISS_THRESHOLD`+ times in a row (counted on
 * `instruments.priceFeedMissCount`/`priceFeedLastMissAt` by every backfill fetch) is past
 * "temporarily lagging": for the next `DEAD_FEED_MISS_THRESHOLD` days after its last miss it
 * is cooling down, and neither the sweep nor a backfill fetch asks the providers again.
 * After that the next attempt runs; a still-dead feed records a new miss and cools down
 * again, so one dead symbol (delisted, bankrupt, a bogus symbol) costs one fetch a week.
 */
export function isDeadFeedCoolingDown(
  health: { priceFeedMissCount: number; priceFeedLastMissAt: Date | null },
  today: string,
): boolean {
  if (health.priceFeedMissCount < DEAD_FEED_MISS_THRESHOLD) return false;
  if (!health.priceFeedLastMissAt) return false;
  const days =
    (Date.parse(`${today}T00:00:00Z`) -
      Date.parse(`${toDateKey(health.priceFeedLastMissAt)}T00:00:00Z`)) /
    86_400_000;
  return days < DEAD_FEED_MISS_THRESHOLD;
}
