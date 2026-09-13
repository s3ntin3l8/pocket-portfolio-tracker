import { Decimal } from "decimal.js";
import type { Holding } from "./types.js";

/** Returns the rate to multiply an amount in `from` to express it in `to`. */
export type FxRateFn = (from: string, to: string) => string;

export interface PriceQuote {
  price: string;
  currency: string;
}

export function convert(amount: string, from: string, to: string, fx: FxRateFn): string {
  if (from === to) return amount;
  return new Decimal(amount).mul(new Decimal(fx(from, to))).toString();
}

export interface NetWorthInput {
  holdings: Holding[];
  prices: Record<string, PriceQuote>;
  cash: Record<string, string>;
  displayCurrency: string;
  fx?: FxRateFn;
  /** Outstanding loan liabilities, already summed to the display currency. */
  liabilities?: string;
  /**
   * Whether a holding missing from `prices` has EVER had a price as of the point in
   * time this net worth is for — independent of why it's missing right now. Governs
   * the #744 cost-basis fallback below: returning `false` (or omitting this callback
   * entirely) means "no usable price at all" → value at cost; returning `true` means
   * it WAS priced at some point but this specific lookup came back empty (e.g. a
   * historical day-by-day series with a gap beyond its own carry-forward bound) →
   * excluded from net worth, same as before #744 — a genuinely-priced holding
   * shouldn't drop to cost and bounce back on the next price purely because of where
   * the gap happened to land. Omit for a live, single-point valuation: the caller's
   * own staleness carry-forward has already resolved "how old is too old" before
   * `prices` ever reaches here, so a miss always means "no usable price, full stop"
   * — see `services/valuation.ts`.
   */
  hasEverPriced?: (instrumentId: string) => boolean;
}

/**
 * Net worth in the display currency: market value of all holdings (priced and
 * FX-converted) plus uninvested cash, minus outstanding loan liabilities. A holding
 * with no price at all is valued at its cost basis instead of skipped — nothing
 * economic happened on the day its feed went silent, so treating it as worth 0 would
 * understate net worth by exactly its cost, not by the (unknown) gain/loss since
 * purchase (issue #744). A holding with neither a price nor a cost basis
 * (costCurrency null — e.g. a zero-price transfer_in with no basis filled in yet)
 * still contributes nothing; that gap is #736's, not this function's, to close.
 */
export function netWorth(input: NetWorthInput): string {
  const fx: FxRateFn = input.fx ?? (() => "1");
  let total = new Decimal(0);

  for (const h of input.holdings) {
    const quote = input.prices[h.instrumentId];
    if (quote) {
      const mv = new Decimal(h.quantity).mul(new Decimal(quote.price)).toString();
      total = total.add(new Decimal(convert(mv, quote.currency, input.displayCurrency, fx)));
    } else if (h.costCurrency && !input.hasEverPriced?.(h.instrumentId)) {
      total = total.add(
        new Decimal(convert(h.costBasis, h.costCurrency, input.displayCurrency, fx)),
      );
    }
  }

  for (const [currency, amount] of Object.entries(input.cash)) {
    total = total.add(new Decimal(convert(amount, currency, input.displayCurrency, fx)));
  }

  if (input.liabilities) total = total.sub(new Decimal(input.liabilities));

  return total.toString();
}
