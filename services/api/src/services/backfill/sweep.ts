import { eq, max, min, isNotNull, inArray } from "drizzle-orm";
import { corporateActions, transactions, portfolioSnapshots, prices } from "@portfolio/db";
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

export interface SweepResult {
  scanned: number;
  healed: number;
  portfolios: Array<{ portfolioId: string; result: BackfillResult }>;
}

export interface SweepOptions {
  force?: boolean;
}

/** Whole days between two YYYY-MM-DD date keys (b − a). */
function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay,
  );
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
  const rows = await db
    .select({
      portfolioId: transactions.portfolioId,
      inception: min(transactions.executedAt),
      earliestSnapshot: min(portfolioSnapshots.date),
    })
    .from(transactions)
    .leftJoin(portfolioSnapshots, eq(transactions.portfolioId, portfolioSnapshots.portfolioId))
    .where(isNotNull(transactions.portfolioId))
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
  const allTxRows = await db.select().from(transactions).where(isNotNull(transactions.portfolioId));
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
        .where(inArray(corporateActions.instrumentId, allInstrIds))
    : [];
  const corpActionsByInstr = new Map<string, CorporateAction[]>();
  for (const ca of caRows) {
    const coreCa: CorporateAction = {
      instrumentId: ca.instrumentId,
      type: ca.type,
      ratio: ca.ratio,
      exDate: new Date(ca.exDate),
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
    const holdings = computeHoldings(coreTxns, allCorpActions, now);
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

  // Per portfolio, the OLDEST latest-price-date across its CURRENTLY HELD instruments —
  // `null` means at least one currently held instrument has never had a price row at all
  // (also stale). `undefined` (no entry) means the portfolio holds nothing priced today.
  const worstLatestPriceByPortfolio = new Map<string, string | null>();
  for (const [portfolioId, heldIds] of heldInstrIdsByPortfolio) {
    for (const instrumentId of heldIds) {
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

  const today = toDateKey(now);
  function isTrailingStale(portfolioId: string): boolean {
    const worst = worstLatestPriceByPortfolio.get(portfolioId);
    if (worst === undefined) return false; // no currently-held priced instruments (e.g. cash-only, or fully exited)
    if (worst === null) return true; // a currently-held instrument has never been priced
    return daysBetween(worst, today) > MAX_PRICE_CARRY_FORWARD_DAYS;
  }

  const toHeal = opts.force
    ? rows.filter((r) => r.portfolioId && r.inception)
    : rows.filter((r) => {
        if (!r.portfolioId || !r.inception) return false;
        const inceptionDate = toDateKey(r.inception);
        if (!r.earliestSnapshot) return true;
        if (r.earliestSnapshot > inceptionDate) return true;
        return isTrailingStale(r.portfolioId);
      });

  const result: SweepResult = { scanned: rows.length, healed: 0, portfolios: [] };

  for (const { portfolioId, inception, earliestSnapshot } of toHeal) {
    if (!portfolioId || !inception) continue;
    // A portfolio healed ONLY because of trailing staleness (its history back to
    // inception is already intact) only needs the gap re-fetched — passing `fromDate`
    // keeps this a tail-only heal instead of a full re-backfill of every portfolio
    // every night. Force mode and a from-inception heal both want the full history.
    const inceptionDate = toDateKey(inception);
    const needsFullHeal = opts.force || !earliestSnapshot || earliestSnapshot > inceptionDate;
    const worst = worstLatestPriceByPortfolio.get(portfolioId);
    const fromDate = !needsFullHeal && worst ? nextDay(worst) : undefined;

    const backfillResult = await backfillPortfolioHistory(
      db,
      marketData,
      ttlMs,
      portfolioId,
      fromDate ? { fromDate } : {},
    );
    result.healed++;
    result.portfolios.push({ portfolioId, result: backfillResult });
  }

  return result;
}
