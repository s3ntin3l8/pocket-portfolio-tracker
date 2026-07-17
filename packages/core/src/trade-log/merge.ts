import type { Decimal } from "decimal.js";
import { ZERO } from "../decimal.js";
import type { TradeLog, TradeMethod, YearTax, YearAmount } from "./types.js";
import { finalizeLog } from "./finalize.js";

/**
 * Merge per-portfolio trade logs into one aggregate (for the cross-portfolio view).
 * Trades are concatenated (a position in two portfolios is two trades); by-year tax
 * buckets are summed; totals and win rate are recomputed. All logs must already be in
 * the same display currency and computed under the same method.
 */
export function mergeTradeLogs(
  logs: TradeLog[],
  displayCurrency: string,
  method: TradeMethod,
): TradeLog {
  const trades = logs.flatMap((l) => l.trades);
  const divMap = new Map<number, { amount: Decimal; tax: Decimal }>();
  const bonusMap = new Map<number, Decimal>();
  for (const l of logs) {
    for (const d of l.dividendsByYear) {
      const e = divMap.get(d.year) ?? { amount: ZERO, tax: ZERO };
      e.amount = e.amount.add(d.amount);
      e.tax = e.tax.add(d.tax);
      divMap.set(d.year, e);
    }
    for (const b of l.bonusesByYear) {
      bonusMap.set(b.year, (bonusMap.get(b.year) ?? ZERO).add(b.amount));
    }
  }
  const dividendsByYear: YearTax[] = [...divMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, { amount, tax }]) => ({
      year,
      amount: amount.toString(),
      tax: tax.toString(),
    }));
  const bonusesByYear: YearAmount[] = [...bonusMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, amount]) => ({ year, amount: amount.toString() }));
  return finalizeLog(trades, dividendsByYear, bonusesByYear, method, displayCurrency);
}
