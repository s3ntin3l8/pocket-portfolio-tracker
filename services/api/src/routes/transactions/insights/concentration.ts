import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { asc, inArray } from "drizzle-orm";
import { corporateActions, instruments, prices, transactions } from "@portfolio/db";
import {
  type CorporateAction,
  computeHoldings,
  splitAdjustmentFactor,
  convert,
  toDateKey,
  PERIOD_GAIN_MAX_PCT,
  PERIOD_LOSS_MAX_PCT,
  MAX_PRICE_CARRY_FORWARD_DAYS,
} from "@portfolio/core";
import { toCoreTxns } from "../../../services/tx-core.js";
import { getFxRatesForDates, makeFxRateFn } from "../../../services/fx.js";

/** Whole days between two YYYY-MM-DD date keys (b − a). */
function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / msPerDay,
  );
}

export interface PeriodMoverResult {
  instrumentId: string;
  symbol: string;
  name: string | null;
  assetClass: string;
  pct: number;
}

export interface BestWorstPair {
  best: PeriodMoverResult | null;
  worst: PeriodMoverResult | null;
  /**
   * Why `best`/`worst` are null, so the UI can say something more specific than a
   * silently missing card. `"stale_prices"` when at least one otherwise-qualifying
   * instrument was excluded because its price feed hasn't updated recently enough to
   * make an "as of now" claim (see `isStaleAsOfLatest`), including a resulting tie
   * (every surviving mover lands on the exact same pct) caused by that exclusion —
   * but NOT a tie among fresh-priced movers, which is a genuine (if unlikely) result,
   * not a data problem, and gets `reason: null`.
   */
  reason: "stale_prices" | null;
}

export async function computeConcentrationSection(
  app: FastifyInstance,
  pfIds: string[],
  dates: string[],
  display: string,
): Promise<{
  concentrationTrend: { date: string; hhi: number; top1Pct: number; classCount: number }[];
  bestWorstMonthly: BestWorstPair;
  bestWorstYearly: BestWorstPair;
}> {
  const concentrationTrend: {
    date: string;
    hhi: number;
    top1Pct: number;
    classCount: number;
  }[] = [];
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].slice(-60);
  let bestWorstMonthly: BestWorstPair = { best: null, worst: null, reason: null };
  let bestWorstYearly: BestWorstPair = { best: null, worst: null, reason: null };

  if (months.length > 0) {
    const allTxRows = await app.db
      .select()
      .from(transactions)
      .where(inArray(transactions.portfolioId, pfIds));
    const instIds = [
      ...new Set(allTxRows.filter((t) => t.instrumentId).map((t) => t.instrumentId!)),
    ];
    const allInstRows = await app.db
      .select()
      .from(instruments)
      .where(inArray(instruments.id, instIds));
    const instMap = new Map(allInstRows.map((i) => [i.id, i]));
    const corpActionRows = await app.db
      .select()
      .from(corporateActions)
      .where(inArray(corporateActions.instrumentId, instIds));
    const corpActions: CorporateAction[] = corpActionRows.map((ca) => ({
      instrumentId: ca.instrumentId,
      type: ca.type,
      ratio: ca.ratio,
      exDate: new Date(ca.exDate),
    }));

    const allPrices = await app.db
      .select()
      .from(prices)
      .where(inArray(prices.instrumentId, instIds))
      .orderBy(asc(prices.date));
    const pricesByInst: Map<string, { date: string; close: string; currency: string }[]> =
      new Map();
    for (const p of allPrices) {
      const list = pricesByInst.get(p.instrumentId) ?? [];
      list.push({ date: p.date, close: p.close, currency: p.currency });
      pricesByInst.set(p.instrumentId, list);
    }

    // Manual-price override: for instruments with a user-set manualPrice (e.g. bonds
    // with no live provider), inject it into the price series so that the latest
    // `latestPriceBefore()` lookup returns the freshest available price for "as of now"
    // claims (current month weight, period movers). Only applied when the manual price
    // is more recent than the last stored `prices` row — a manual price set last month
    // doesn't override today's live-captured price.
    for (const inst of allInstRows) {
      if (inst.manualPrice && Number(inst.manualPrice) > 0 && inst.manualPriceAt) {
        const manualDate = toDateKey(new Date(inst.manualPriceAt));
        const list = pricesByInst.get(inst.id) ?? [];
        const lastStored = list.length > 0 ? list[list.length - 1]!.date : "";
        if (manualDate > lastStored) {
          if (!list.length || list[list.length - 1]!.date !== manualDate) {
            list.push({ date: manualDate, close: inst.manualPrice, currency: inst.currency });
          }
        }
        // Always re-set: the list may have been freshly created (?? []).
        pricesByInst.set(inst.id, list);
      }
    }

    // The latest known price on or before `asOfDate` — a plain backward-looking lookup,
    // deliberately NOT staleness-gated here: a period-START anchor (monthStart/yearStart)
    // or an earlier month in the concentration trend legitimately finds a price from
    // well before `asOfDate` (e.g. a position bought mid-month with no price tick before
    // the 1st) — that's a correct "last known value at that point in time", not staleness.
    // Staleness only means something when the claim is "as of THE CURRENT MOMENT" — see
    // `isStaleAsOfLatest` below, applied only to lookups anchored at `latestDate`.
    const latestPriceBefore = (
      instId: string,
      asOfDate: string,
    ): { date: string; close: string; currency: string } | null => {
      const list = pricesByInst.get(instId);
      if (!list || list.length === 0) return null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].date <= asOfDate) return list[i];
      }
      return null;
    };

    // FX rates for the concentration-trend HHI, which converts each holding's native-
    // currency market value to the display currency before weighting — only needed for
    // the (few) month-end dates actually used below, not the full daily date range.
    const monthEndDates = months
      .map((m) => dates.filter((d) => d.startsWith(m)).at(-1))
      .filter((d): d is string => d != null);
    const priceCurrencies = [...new Set(allPrices.map((p) => p.currency))];
    const concentrationFxRates = await getFxRatesForDates(
      app.db,
      priceCurrencies,
      display,
      monthEndDates,
    );

    // The most recent date this whole /insights response covers — the only date at
    // which "this price is stale" is a meaningful claim (see `latestPriceBefore`'s
    // comment). Reused by both the concentration trend's current month and the
    // period-movers' END lookup below.
    const latestDate = dates[dates.length - 1];
    const isStaleAsOfLatest = (priceDate: string): boolean =>
      daysBetween(priceDate, latestDate) > MAX_PRICE_CARRY_FORWARD_DAYS;

    const coreTxns = toCoreTxns(allTxRows);
    for (const month of months) {
      const monthDates = dates.filter((d) => d.startsWith(month));
      if (monthDates.length === 0) continue;
      const asOfDate = monthDates[monthDates.length - 1];
      const isCurrentMonth = asOfDate === latestDate;
      const asOf = new Date(`${asOfDate}T23:59:59.999Z`);

      const holdings = computeHoldings(coreTxns, corpActions, asOf);
      const fx = makeFxRateFn(concentrationFxRates.get(asOfDate) ?? {}, display);

      let totalMv = 0;
      const mvByInst: { mv: number; assetClass: string }[] = [];
      for (const h of holdings) {
        const qty = Number(h.quantity);
        if (qty <= 0 || !h.instrumentId) continue;
        const price = latestPriceBefore(h.instrumentId, asOfDate);
        if (!price) continue;
        // Only the CURRENT month's weight is an "as of now" claim — a stale feed here
        // would silently hold a dead instrument's last-known weight steady forever.
        // Earlier months are historical and unaffected: whatever was the last known
        // price back then is, by definition, the correct value for that point in time.
        if (isCurrentMonth && isStaleAsOfLatest(price.date)) continue;
        const mv = Number(
          convert((qty * Number(price.close)).toString(), price.currency, display, fx),
        );
        const inst = instMap.get(h.instrumentId);
        mvByInst.push({ mv, assetClass: inst?.assetClass ?? "equity" });
        totalMv += mv;
      }

      if (totalMv > 0 && mvByInst.length > 0) {
        const fractions = mvByInst.map((x) => x.mv / totalMv);
        const hhi = fractions.reduce((sum, f) => sum + f * f, 0);
        const top1Fraction = Math.max(...fractions);
        const classes = new Set(mvByInst.map((x) => x.assetClass));

        concentrationTrend.push({
          date: month,
          hhi: Math.round(hhi * 10000) / 10000,
          top1Pct: Math.round(top1Fraction * 10000) / 100,
          classCount: classes.size,
        });
      }
    }

    // ── Period best/worst performers (MTD, YTD) ──────────────────────
    const monthStart = latestDate.slice(0, 7) + "-01";
    const yearStart = latestDate.slice(0, 4) + "-01-01";
    const periodEnd = new Date(`${latestDate}T23:59:59.999Z`);

    const heldAtStart = new Set(
      computeHoldings(coreTxns, corpActions, new Date(`${monthStart}T00:00:00.000Z`))
        .filter((h) => Number(h.quantity) > 0 && h.instrumentId)
        .map((h) => h.instrumentId!),
    );
    const heldAtYearStart = new Set(
      computeHoldings(coreTxns, corpActions, new Date(`${yearStart}T00:00:00.000Z`))
        .filter((h) => Number(h.quantity) > 0 && h.instrumentId)
        .map((h) => h.instrumentId!),
    );
    const heldAtEnd = new Map(
      computeHoldings(coreTxns, corpActions, periodEnd)
        .filter((h) => Number(h.quantity) > 0 && h.instrumentId)
        .map((h) => [h.instrumentId!, h]),
    );

    const computePeriodMovers = (startDate: string, heldAtStartSet: Set<string>): BestWorstPair => {
      const movers: PeriodMoverResult[] = [];
      let staleSkipped = 0;
      for (const instId of heldAtEnd.keys()) {
        if (!heldAtStartSet.has(instId)) continue;
        const priceStart = latestPriceBefore(instId, startDate);
        const priceEnd = latestPriceBefore(instId, latestDate);
        if (!priceStart || !priceEnd || Number(priceStart.close) <= 0) continue;
        // The END price is an "as of right now" claim — if the feed hasn't updated in
        // MAX_PRICE_CARRY_FORWARD_DAYS, this instrument's move can't be reported at all
        // (excluded from the ranking, not defaulted to a fabricated 0.00%). The START
        // price has no such requirement — it's a backward-looking anchor.
        if (isStaleAsOfLatest(priceEnd.date)) {
          staleSkipped++;
          continue;
        }

        const saStart = splitAdjustmentFactor(corpActions, instId, startDate);
        const saEnd = splitAdjustmentFactor(corpActions, instId, latestDate);
        if (saStart.isZero() || saEnd.isZero()) continue;
        const adjustedStart = new Decimal(priceStart.close).div(saStart);
        const adjustedEnd = new Decimal(priceEnd.close).div(saEnd);
        const pct = adjustedEnd.div(adjustedStart).toNumber() - 1;

        // Sanity gate: returns beyond PERIOD_GAIN_MAX_PCT (gain) or PERIOD_LOSS_MAX_PCT
        // (loss) in a month/year are almost certainly data quality issues (stale price,
        // missing corporate action, Yahoo API mismatch) rather than genuine market moves.
        // The bounds are asymmetric: a long-only equity cannot lose more than −100%, so
        // a near-total wipeout is suspicious, while genuine multi-baggers are still
        // excluded only beyond the gain cap.  See sanity-gates.ts for the rationale.
        if (pct > PERIOD_GAIN_MAX_PCT / 100 || pct < -PERIOD_LOSS_MAX_PCT / 100) {
          app.log.warn(
            { symbol: instMap.get(instId)?.symbol, pct, window: `${startDate}→${latestDate}` },
            "[insights] skipped implausible period mover",
          );
          continue;
        }

        const inst = instMap.get(instId);
        if (!inst) continue;
        movers.push({
          instrumentId: instId,
          symbol: inst.symbol ?? "—",
          name: inst.name,
          assetClass: inst.assetClass ?? "equity",
          pct,
        });
      }
      if (movers.length < 2) {
        return { best: null, worst: null, reason: staleSkipped > 0 ? "stale_prices" : null };
      }
      movers.sort((a, b) => b.pct - a.pct);
      const best = movers[0];
      const worst = movers[movers.length - 1];
      // A zero spread (every surviving mover moved by the exact same amount) isn't a
      // meaningful ranking — "best" and "worst" would just be an arbitrary tie-break,
      // not a real comparison. In practice this only happens when every remaining
      // price is frozen at the same stale carry-forward — but only label it that way
      // when staleness actually caused a skip; a genuine zero-spread tie (e.g. every
      // holding priced in a market that hasn't opened yet) isn't a stale-data problem.
      if (best.pct === worst.pct) {
        return { best: null, worst: null, reason: staleSkipped > 0 ? "stale_prices" : null };
      }
      return { best, worst, reason: null };
    };

    bestWorstMonthly = computePeriodMovers(monthStart, heldAtStart);
    bestWorstYearly = computePeriodMovers(yearStart, heldAtYearStart);
  }

  return {
    concentrationTrend,
    bestWorstMonthly,
    bestWorstYearly,
  };
}
