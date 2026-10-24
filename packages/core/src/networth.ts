import { Decimal } from "decimal.js";
import type { CoreTransaction, Holding } from "./types.js";

/**
 * Returns the rate to multiply an amount in `from` to express it in `to`, or `null`
 * when no rate is known for the pair (audit B2). A missing rate must never be
 * silently treated as 1:1 — `convert()` throws {@link FxRateMissingError} on it, and
 * valuation paths that can degrade gracefully probe with {@link tryConvert} /
 * {@link fxAvailable} first and flag the affected amounts (`fxMissing`) instead.
 */
export type FxRateFn = (from: string, to: string) => string | null;

/** Thrown by {@link convert} when the FX function has no rate for the pair. */
export class FxRateMissingError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`No FX rate available for ${from} -> ${to}`);
    this.name = "FxRateMissingError";
  }
}

export interface PriceQuote {
  price: string;
  currency: string;
}

/**
 * Convert `amount` from `from` into `to`. Throws {@link FxRateMissingError} when the
 * rate is unknown — callers that must keep going (valuation, snapshots) check
 * {@link fxAvailable} or use {@link tryConvert} instead.
 */
export function convert(amount: string, from: string, to: string, fx: FxRateFn): string {
  const out = tryConvert(amount, from, to, fx);
  if (out === null) throw new FxRateMissingError(from, to);
  return out;
}

/** Like {@link convert}, but returns `null` instead of throwing on an unknown rate. */
export function tryConvert(amount: string, from: string, to: string, fx: FxRateFn): string | null {
  if (from === to) return amount;
  const rate = fx(from, to);
  if (rate === null) return null;
  return new Decimal(amount).mul(new Decimal(rate)).toString();
}

/** Whether `fx` can convert `from` into `to` (always true for the same currency). */
export function fxAvailable(from: string, to: string, fx: FxRateFn): boolean {
  return from === to || fx(from, to) !== null;
}

/**
 * Wrap an FX function for PURE SUM aggregations (income totals, projections): a missing
 * rate becomes "0", so the unconvertible amount is excluded from every converted sum
 * rather than counted 1:1 or failing the computation (audit B2). The caller must still
 * report the missing currencies (the API's `makeFxRateFn` records them per request).
 * Never use where a converted amount is a divisor, a per-item display value, or a
 * series point (a 0 there reads as a real value) — exclude those rows explicitly.
 */
export function excludeMissingFx(fx: FxRateFn): FxRateFn {
  return (from, to) => fx(from, to) ?? "0";
}

/**
 * Split transactions into those whose amounts can be expressed in `display` and the
 * currencies that can't (audit B2), for consumers that convert per transaction and must
 * EXCLUDE what they can't convert rather than fail or guess 1:1. Instrument rows are
 * kept or dropped per instrument — every row of an instrument feeds one cost basis, so
 * dropping a single leg would corrupt the rest — and an instrument is dropped when any of
 * its rows' currencies, or its quote currency (`quoteCurrencyOf`), is unconvertible.
 * Instrument-less (cash) rows are dropped individually. `missing` is sorted.
 */
export function partitionConvertible(
  txns: CoreTransaction[],
  display: string,
  fx: FxRateFn,
  quoteCurrencyOf?: (instrumentId: string) => string | undefined,
): { convertible: CoreTransaction[]; missing: string[] } {
  const ok = new Map<string, boolean>();
  const missing = new Set<string>();
  const canConvert = (ccy: string): boolean => {
    let v = ok.get(ccy);
    if (v === undefined) {
      v = fxAvailable(ccy, display, fx);
      ok.set(ccy, v);
    }
    if (!v) missing.add(ccy);
    return v;
  };
  const droppedInstruments = new Set<string>();
  for (const tx of txns) {
    if (!tx.instrumentId) continue;
    const quote = quoteCurrencyOf?.(tx.instrumentId);
    // Evaluate both so every missing currency is reported, not just the first.
    const txOk = canConvert(tx.currency);
    const quoteOk = quote === undefined ? true : canConvert(quote);
    if (!txOk || !quoteOk) droppedInstruments.add(tx.instrumentId);
  }
  const convertible = txns.filter((tx) =>
    tx.instrumentId ? !droppedInstruments.has(tx.instrumentId) : canConvert(tx.currency),
  );
  return { convertible, missing: [...missing].sort() };
}

export interface NetWorthInput {
  holdings: Holding[];
  prices: Record<string, PriceQuote>;
  cash: Record<string, string>;
  displayCurrency: string;
  fx: FxRateFn;
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
  const fx: FxRateFn = input.fx;
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
