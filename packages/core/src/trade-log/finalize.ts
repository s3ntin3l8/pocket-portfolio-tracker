import { Decimal } from "decimal.js";
import { ZERO } from "../decimal.js";
import type { Trade, TradeLog, TradeMethod, YearAmount, YearTax } from "./types.js";

/** Open first, then most-recent entry date on top. */
export function sortTrades(trades: Trade[]): void {
  trades.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0;
  });
}

/** Assemble the final TradeLog: sort, realized-by-year (from legs), totals, win rate. */
export function finalizeLog(
  trades: Trade[],
  dividendsByYear: YearTax[],
  bonusesByYear: YearAmount[],
  method: TradeMethod,
  display: string,
): TradeLog {
  sortTrades(trades);

  // realizedByYear (method-aware) from leg tax years.
  const realizedMap = new Map<number, Decimal>();
  for (const t of trades) {
    for (const leg of t.legs) {
      realizedMap.set(leg.taxYear, (realizedMap.get(leg.taxYear) ?? ZERO).add(leg.gain));
    }
  }
  const realizedByYear: YearAmount[] = [...realizedMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, amount]) => ({ year, amount: amount.toString() }));

  let totalRealized = ZERO;
  let totalDividends = ZERO;
  let totalReturn = ZERO;
  let closed = 0;
  let wins = 0;
  for (const t of trades) {
    totalRealized = totalRealized.add(t.realizedPnL);
    totalDividends = totalDividends.add(t.dividends);
    totalReturn = totalReturn.add(t.totalReturn);
    if (t.status === "closed") {
      closed += 1;
      if (new Decimal(t.totalReturn).gt(0)) wins += 1;
    }
  }

  return {
    displayCurrency: display,
    method,
    trades,
    totalRealized: totalRealized.toString(),
    totalDividends: totalDividends.toString(),
    totalReturn: totalReturn.toString(),
    winRate: closed > 0 ? wins / closed : null,
    realizedByYear,
    dividendsByYear,
    bonusesByYear,
  };
}
