import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { asc, inArray } from "drizzle-orm";
import { corporateActions, instruments, prices, transactions } from "@portfolio/db";
import { type CorporateAction, computeHoldings, splitAdjustmentFactor } from "@portfolio/core";
import { toCoreTxns } from "../../../services/tx-core.js";

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
}

export async function computeConcentrationSection(
  app: FastifyInstance,
  pfIds: string[],
  dates: string[],
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
  let bestWorstMonthly: BestWorstPair = { best: null, worst: null };
  let bestWorstYearly: BestWorstPair = { best: null, worst: null };

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
    const pricesByInst: Map<string, { date: string; close: string }[]> = new Map();
    for (const p of allPrices) {
      const list = pricesByInst.get(p.instrumentId) ?? [];
      list.push({ date: p.date, close: p.close });
      pricesByInst.set(p.instrumentId, list);
    }
    const latestPriceBefore = (instId: string, asOfDate: string): string | null => {
      const list = pricesByInst.get(instId);
      if (!list || list.length === 0) return null;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].date <= asOfDate) return list[i].close;
      }
      return null;
    };

    const coreTxns = toCoreTxns(allTxRows);
    for (const month of months) {
      const monthDates = dates.filter((d) => d.startsWith(month));
      if (monthDates.length === 0) continue;
      const asOfDate = monthDates[monthDates.length - 1];
      const asOf = new Date(`${asOfDate}T23:59:59.999Z`);

      const holdings = computeHoldings(coreTxns, corpActions, asOf);

      let totalMv = 0;
      const mvByInst: { mv: number; assetClass: string }[] = [];
      for (const h of holdings) {
        const qty = Number(h.quantity);
        if (qty <= 0 || !h.instrumentId) continue;
        const price = latestPriceBefore(h.instrumentId, asOfDate);
        if (!price) continue;
        const mv = qty * Number(price);
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
    const latestDate = dates[dates.length - 1];
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
      for (const instId of heldAtEnd.keys()) {
        if (!heldAtStartSet.has(instId)) continue;
        const rawStart = latestPriceBefore(instId, startDate);
        const rawEnd = latestPriceBefore(instId, latestDate);
        if (!rawStart || !rawEnd || Number(rawStart) <= 0) continue;

        const saStart = splitAdjustmentFactor(corpActions, instId, startDate);
        const saEnd = splitAdjustmentFactor(corpActions, instId, latestDate);
        if (saStart.isZero() || saEnd.isZero()) continue;
        const adjustedStart = new Decimal(rawStart).div(saStart);
        const adjustedEnd = new Decimal(rawEnd).div(saEnd);
        const pct = adjustedEnd.div(adjustedStart).toNumber() - 1;

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
      if (movers.length < 2) return { best: null, worst: null };
      movers.sort((a, b) => b.pct - a.pct);
      return { best: movers[0], worst: movers[movers.length - 1] };
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
