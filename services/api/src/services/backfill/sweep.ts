import { and, eq, gte, max, min, isNotNull, inArray, isNull, or, sql } from "drizzle-orm";
import {
  corporateActions,
  instruments,
  portfolios,
  transactions,
  portfolioSnapshots,
  prices,
} from "@portfolio/db";
import {
  computeHoldings,
  toDateKey,
  MAX_PRICE_CARRY_FORWARD_DAYS,
  type CorporateAction,
} from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import type { DB } from "../../db/client.js";
import { toCoreTxns } from "../tx-core.js";
import { backfillPortfolioHistory, type BackfillResult } from "./core.js";
import { firstHeldDateFrom, isDeadFeedCoolingDown, isManualPriceBond } from "./shared.js";

export interface SweepResult {
  scanned: number;
  /** Backfilled inline (no `opts.enqueue` supplied) — same meaning as before #745. */
  healed: number;
  /** Actually enqueued onto BACKFILL_PORTFOLIO_QUEUE via `opts.enqueue`. */
  queued: number;
  /**
   * `opts.enqueue` returned `false` (send failed — e.g. a DB hiccup) for this many
   * portfolios. `queued` only counts confirmed sends, so a caller distinguishing
   * "planned N heals, actually enqueued fewer" from a clean run should check this
   * rather than infer it from `scanned − queued` (which also includes portfolios
   * that didn't need healing at all).
   */
  enqueueFailed: number;
  /** Populated only for portfolios healed inline (`opts.enqueue` not supplied). */
  portfolios: Array<{ portfolioId: string; result: BackfillResult }>;
}

export interface SweepOptions {
  force?: boolean;
  /** Scope the sweep (and force mode) to one user's portfolios instead of every user's. */
  userId?: string;
  /**
   * When supplied, the sweep enqueues each portfolio's backfill onto
   * BACKFILL_PORTFOLIO_QUEUE instead of running it inline — see issue #745. Returns
   * whether the enqueue actually succeeded (the sweep is the sole delivery mechanism for
   * the whole fan-out, so a swallowed send failure here must not be counted as `queued`).
   * Direct callers (tests, dev scripts) that omit this keep today's synchronous behavior.
   */
  enqueue?: (
    portfolioId: string,
    fromDate?: string,
    tailOnly?: boolean,
    retryDeadFeeds?: boolean,
  ) => Promise<boolean>;
  /**
   * Ask the providers even for feeds cooling down as dead (see `isDeadFeedCoolingDown`).
   * Deliberately separate from `force`: a forced re-backfill re-derives snapshots, it must
   * not silently re-hit a delisted symbol. Set by an operator who knows the feed is back.
   */
  retryDeadFeeds?: boolean;
}

/** How far back the sweep looks for a hole in the MIDDLE of a held instrument's prices. */
const MID_GAP_LOOKBACK_DAYS = 365;

/** Whole days between two YYYY-MM-DD date keys (b − a). */
function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay,
  );
}

function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateKey(d);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return toDateKey(d);
}

export async function backfillStalePortfolios(
  db: DB,
  marketData: MarketDataService,
  ttlMs: number,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const userFilter = opts.userId ? eq(portfolios.userId, opts.userId) : undefined;

  const rows = await db
    .select({
      portfolioId: transactions.portfolioId,
      inception: min(transactions.executedAt),
      earliestSnapshot: min(portfolioSnapshots.date),
    })
    .from(transactions)
    .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
    .leftJoin(portfolioSnapshots, eq(transactions.portfolioId, portfolioSnapshots.portfolioId))
    .where(
      userFilter
        ? and(isNotNull(transactions.portfolioId), userFilter)
        : isNotNull(transactions.portfolioId),
    )
    .groupBy(transactions.portfolioId);

  // Trailing-edge staleness: a portfolio that is fully backfilled from inception can
  // still have `prices` stop updating for one of its CURRENTLY HELD instruments weeks
  // later — the earliest-snapshot check above never re-visits it once healed once. For
  // each portfolio, find the OLDEST "latest price date" among instruments it still
  // holds today (via computeHoldings, not "ever transacted" — an instrument fully
  // exited years ago would otherwise mark the portfolio stale forever, triggering a
  // nightly re-fetch attempt indefinitely); if the worst case is more than
  // MAX_PRICE_CARRY_FORWARD_DAYS behind today, the portfolio needs a tail heal even
  // though its history back to inception is intact.
  const allTxRows = opts.userId
    ? await db
        .select({ transactions })
        .from(transactions)
        .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
        .where(and(isNotNull(transactions.portfolioId), eq(portfolios.userId, opts.userId)))
        .then((r) => r.map((row) => row.transactions))
    : await db.select().from(transactions).where(isNotNull(transactions.portfolioId));
  const txByPortfolio = new Map<string, typeof allTxRows>();
  for (const t of allTxRows) {
    if (!t.portfolioId) continue;
    const list = txByPortfolio.get(t.portfolioId) ?? [];
    list.push(t);
    txByPortfolio.set(t.portfolioId, list);
  }
  const allInstrIds = [
    ...new Set(allTxRows.map((t) => t.instrumentId).filter((x): x is string => x != null)),
  ];
  const caRows = allInstrIds.length
    ? await db
        .select()
        .from(corporateActions)
        .where(
          and(
            inArray(corporateActions.instrumentId, allInstrIds),
            or(
              isNull(corporateActions.portfolioId),
              inArray(corporateActions.portfolioId, [...txByPortfolio.keys()]),
            ),
          ),
        )
    : [];
  const corpActionsByInstr = new Map<string, CorporateAction[]>();
  for (const ca of caRows) {
    const coreCa: CorporateAction = {
      instrumentId: ca.instrumentId,
      type: ca.type,
      ratio: ca.ratio,
      exDate: new Date(ca.exDate),
      portfolioId: ca.portfolioId,
      targetInstrumentId: ca.targetInstrumentId ?? undefined,
      ratioTo: ca.ratioTo ?? undefined,
      taxableMarketValue: ca.taxableMarketValue ?? undefined,
    };
    const list = corpActionsByInstr.get(ca.instrumentId) ?? [];
    list.push(coreCa);
    corpActionsByInstr.set(ca.instrumentId, list);
  }
  const allCorpActions = [...corpActionsByInstr.values()].flat();

  const now = new Date();
  const heldInstrIdsByPortfolio = new Map<string, Set<string>>();
  for (const [portfolioId, txRows] of txByPortfolio) {
    const coreTxns = toCoreTxns(txRows);
    const holdings = computeHoldings(
      coreTxns,
      allCorpActions.filter((ca) => ca.portfolioId == null || ca.portfolioId === portfolioId),
      now,
    );
    const heldIds = new Set(
      holdings.filter((h) => Number(h.quantity) > 0 && h.instrumentId).map((h) => h.instrumentId!),
    );
    heldInstrIdsByPortfolio.set(portfolioId, heldIds);
  }

  const currentlyHeldInstrIds = [
    ...new Set([...heldInstrIdsByPortfolio.values()].flatMap((s) => [...s])),
  ];
  const latestPriceRows = currentlyHeldInstrIds.length
    ? await db
        .select({ instrumentId: prices.instrumentId, latest: max(prices.date) })
        .from(prices)
        .where(inArray(prices.instrumentId, currentlyHeldInstrIds))
        .groupBy(prices.instrumentId)
    : [];
  const latestPriceByInstr = new Map(latestPriceRows.map((r) => [r.instrumentId, r.latest]));

  const today = toDateKey(now);

  // #737 — a feed that has failed DEAD_FEED_MISS_THRESHOLD+ times in a row (tracked on
  // `instruments.priceFeedMissCount`/`priceFeedLastMissAt`, updated by
  // backfillPortfolioHistory on every fetch attempt — counts BOTH empty results and
  // provider throws, see the comment in core.ts) is past "temporarily lagging" and into
  // "may have nothing left to give". Once past the threshold, only let it count toward
  // staleness again once every DEAD_FEED_MISS_THRESHOLD days — otherwise one dead symbol
  // keeps its whole portfolio marked stale (and re-fetched) every single night.
  const feedHealthRows = currentlyHeldInstrIds.length
    ? await db
        .select({
          id: instruments.id,
          assetClass: instruments.assetClass,
          faceValue: instruments.faceValue,
          manualPrice: instruments.manualPrice,
          priceFeedMissCount: instruments.priceFeedMissCount,
          priceFeedLastMissAt: instruments.priceFeedLastMissAt,
        })
        .from(instruments)
        .where(inArray(instruments.id, currentlyHeldInstrIds))
    : [];
  const feedHealthByInstr = new Map(feedHealthRows.map((r) => [r.id, r]));
  // A bond with a manual price (one `prices` row per reprice) or no face value is never
  // fetched or par-filled by the backfill, so no heal can change its prices and no miss is
  // ever recorded for the cooldown to engage — healing it would re-run every night. (A
  // par bond is written daily from the fetch window, so its holes ARE healable.)
  function isUnhealableBond(instrumentId: string): boolean {
    const h = feedHealthByInstr.get(instrumentId);
    return !!h && h.assetClass === "bond" && (isManualPriceBond(h) || !h.faceValue);
  }
  function isCoolingDownDeadFeed(instrumentId: string): boolean {
    const health = feedHealthByInstr.get(instrumentId);
    return !!health && isDeadFeedCoolingDown(health, today);
  }

  // Per portfolio, the OLDEST latest-price-date across its CURRENTLY HELD instruments —
  // `null` means at least one currently held instrument has never had a price row at all
  // (also stale). `undefined` (no entry) means the portfolio holds nothing priced today.
  // Instruments whose feed is past-threshold-dead and still cooling down are excluded —
  // they don't get to keep marking the whole portfolio stale every night.
  const worstLatestPriceByPortfolio = new Map<string, string | null>();
  for (const [portfolioId, heldIds] of heldInstrIdsByPortfolio) {
    for (const instrumentId of heldIds) {
      if (isCoolingDownDeadFeed(instrumentId) || isUnhealableBond(instrumentId)) continue;
      const latest = latestPriceByInstr.get(instrumentId) ?? null;
      const cur = worstLatestPriceByPortfolio.get(portfolioId);
      if (cur === undefined) {
        worstLatestPriceByPortfolio.set(portfolioId, latest);
      } else if (cur === null || latest === null) {
        worstLatestPriceByPortfolio.set(portfolioId, null);
      } else if (latest < cur) {
        worstLatestPriceByPortfolio.set(portfolioId, latest);
      }
    }
  }

  function isTrailingStale(portfolioId: string): boolean {
    const worst = worstLatestPriceByPortfolio.get(portfolioId);
    if (worst === undefined) return false; // no currently-held priced instruments (e.g. cash-only, or fully exited)
    if (worst === null) return true; // a currently-held instrument has never been priced
    return daysBetween(worst, today) > MAX_PRICE_CARRY_FORWARD_DAYS;
  }

  // Mid-history gaps: the trailing check above only sees the NEWEST price, so a feed that
  // skipped weeks and then recovered looks healthy forever — while the snapshots written
  // during the hole value the holding at 0/cost and are never revisited. Per portfolio,
  // find the earliest hole longer than the carry-forward window in a held instrument's
  // prices (within the last MID_GAP_LOOKBACK_DAYS, and not before the portfolio first held
  // it). A feed that keeps leaving the hole open counts as a miss (see priceGapRemains),
  // so the dead-feed cooldown stops this re-fetching it every night.
  const gapCutoffDate = new Date(`${today}T00:00:00Z`);
  gapCutoffDate.setUTCDate(gapCutoffDate.getUTCDate() - MID_GAP_LOOKBACK_DAYS);
  // One window query for the holes themselves (not every price row for every held
  // instrument): rows whose previous price date is more than the carry-forward window
  // earlier. Interior only — the stale tail is isTrailingStale's job.
  const priceWindow = db
    .select({
      instrumentId: prices.instrumentId,
      date: prices.date,
      prev: sql<
        string | null
      >`lag(${prices.date}) over (partition by ${prices.instrumentId} order by ${prices.date})`.as(
        "prev",
      ),
    })
    .from(prices)
    .where(
      and(
        inArray(prices.instrumentId, currentlyHeldInstrIds),
        gte(prices.date, toDateKey(gapCutoffDate)),
      ),
    )
    .as("price_window");
  const gapRows = currentlyHeldInstrIds.length
    ? await db
        .select({
          instrumentId: priceWindow.instrumentId,
          date: priceWindow.date,
          prev: priceWindow.prev,
        })
        .from(priceWindow)
        .where(
          sql`${priceWindow.prev} is not null and (${priceWindow.date}::date - ${priceWindow.prev}::date) > ${MAX_PRICE_CARRY_FORWARD_DAYS}`,
        )
    : [];
  const midGapsByInstr = new Map<string, { from: string; to: string }[]>();
  for (const r of gapRows) {
    const list = midGapsByInstr.get(r.instrumentId) ?? [];
    list.push({ from: nextDay(r.prev!), to: prevDay(r.date) });
    midGapsByInstr.set(r.instrumentId, list);
  }
  const midGapStartByPortfolio = new Map<string, string>();
  for (const [portfolioId, heldIds] of heldInstrIdsByPortfolio) {
    for (const instrumentId of heldIds) {
      const gaps = midGapsByInstr.get(instrumentId);
      if (!gaps || isUnhealableBond(instrumentId) || isCoolingDownDeadFeed(instrumentId)) continue;
      const firstHeld = firstHeldDateFrom(txByPortfolio.get(portfolioId) ?? [], instrumentId);
      if (!firstHeld) continue;
      for (const g of gaps) {
        if (g.to < firstHeld) continue;
        const from = g.from > firstHeld ? g.from : firstHeld;
        const cur = midGapStartByPortfolio.get(portfolioId);
        if (!cur || from < cur) midGapStartByPortfolio.set(portfolioId, from);
      }
    }
  }

  const toHeal = opts.force
    ? rows.filter((r) => r.portfolioId && r.inception)
    : rows.filter((r) => {
        if (!r.portfolioId || !r.inception) return false;
        const inceptionDate = toDateKey(r.inception);
        if (!r.earliestSnapshot) return true;
        if (r.earliestSnapshot > inceptionDate) return true;
        return isTrailingStale(r.portfolioId) || midGapStartByPortfolio.has(r.portfolioId);
      });

  const result: SweepResult = {
    scanned: rows.length,
    healed: 0,
    queued: 0,
    enqueueFailed: 0,
    portfolios: [],
  };

  for (const { portfolioId, inception, earliestSnapshot } of toHeal) {
    if (!portfolioId || !inception) continue;
    // A portfolio healed ONLY because of trailing staleness (its history back to
    // inception is already intact) only needs the gap re-fetched — passing `fromDate`
    // (and `tailOnly`, so an empty result isn't read as "fetch everything again") keeps
    // this a tail-only heal instead of a full re-backfill of every portfolio every
    // night. Force mode and a from-inception heal both want the full history.
    const inceptionDate = toDateKey(inception);
    const needsFullHeal = opts.force || !earliestSnapshot || earliestSnapshot > inceptionDate;
    const worst = worstLatestPriceByPortfolio.get(portfolioId);
    const trailingFrom = !needsFullHeal && worst ? nextDay(worst) : undefined;
    const gapFrom = !needsFullHeal ? midGapStartByPortfolio.get(portfolioId) : undefined;
    const fromDate =
      trailingFrom && gapFrom && gapFrom < trailingFrom ? gapFrom : (trailingFrom ?? gapFrom);
    const tailOnly = !needsFullHeal && Boolean(fromDate);

    if (opts.enqueue) {
      const ok = await opts.enqueue(portfolioId, fromDate, tailOnly, opts.retryDeadFeeds);
      if (ok) result.queued++;
      else result.enqueueFailed++;
      continue;
    }

    const backfillResult = await backfillPortfolioHistory(db, marketData, ttlMs, portfolioId, {
      ...(fromDate ? { fromDate, tailOnly } : {}),
      ...(opts.retryDeadFeeds ? { retryDeadFeeds: true } : {}),
    });
    result.healed++;
    result.portfolios.push({ portfolioId, result: backfillResult });
  }

  return result;
}
