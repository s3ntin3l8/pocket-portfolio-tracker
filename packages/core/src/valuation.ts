import { Decimal } from "decimal.js";
import { computeHoldings, marketValue } from "./holdings.js";
import { cashBalances, cashFlow } from "./cash.js";
import { netWorth, convert, fxAvailable, type FxRateFn } from "./networth.js";
import { financingByInstrument, liabilityBalances } from "./loans.js";
import type { CoreTransaction, CorporateAction, Holding } from "./types.js";
import type { LotView } from "./lots.js";
import { SINGLE_DAY_MAX_PCT } from "./sanity-gates.js";

/**
 * How a financed holding's cost basis is reported. "purchase_price" keeps the
 * gold at its G24 price and treats financing as a separate expense;
 * "total_paid" capitalizes the financing (admin + margin − discount) incurred
 * to date into the cost basis. Net worth is invariant to this choice — only
 * cost-basis/P&L attribution moves.
 */
export type CostBasisMode = "purchase_price" | "total_paid";

export interface HoldingValuation extends Holding {
  price: string | null;
  currency: string | null;
  marketValue: string | null;
  unrealizedPnL: string | null;
  /** Market value FX-converted to the display currency (null when unpriced). */
  marketValueDisplay: string | null;
  /** Cost basis FX-converted to the display currency. */
  costBasisDisplay: string;
  /** Unrealized P&L in the display currency (null when unpriced). */
  unrealizedPnLDisplay: string | null;
  /**
   * True when this holding has no usable market price — never priced, or priced
   * but too stale to carry forward (the caller drops a quote past
   * `MAX_PRICE_CARRY_FORWARD_DAYS` before it ever reaches `summarizePortfolio`,
   * so both cases arrive here identically as "no quote") — and is therefore valued
   * at cost basis instead: `marketValueDisplay`/`costBasisDisplay` are equal and
   * `unrealizedPnLDisplay` is "0". Nothing economic happened on the day a feed
   * goes silent, so valuing at 0 would understate net worth by the whole cost
   * basis, not by the unknown gain/loss since purchase (issue #744). Undefined
   * for a normally-priced holding.
   */
  valuedAtCost?: boolean;
  /**
   * True when this holding's quote or cost currency has no known FX rate into the
   * display currency (audit B2). The display-currency fields (`marketValueDisplay`,
   * `unrealizedPnLDisplay`) are then null, `costBasisDisplay` stays in the native cost
   * currency, and the holding is excluded from every display-currency total — a
   * missing rate is never treated as 1:1. Undefined when FX resolved normally.
   */
  fxMissing?: boolean;
  /** Prior session's close (instrument currency), when known. */
  previousClose: string | null;
  /** Today's value change for the position (instrument currency), when known. */
  dayChange: string | null;
  /** Today's price move as a percentage, when known. */
  dayChangePct: string | null;
  /**
   * Standing open FIFO lots (acquisition order, oldest first), for a per-lot cost-basis
   * display (e.g. instrument detail page). NOT populated by `summarizePortfolio` itself —
   * `summarizePortfolio` has no lot ledger of its own (only `computeHoldings`'s average-cost
   * aggregate); callers that also have the transaction/corporate-action set attach this via
   * `openLots()` after valuing. Undefined when the caller didn't attach it.
   */
  lots?: LotView[];
  /**
   * Recent daily closes (oldest→newest, instrument currency) for the mobile holdings
   * sparkline. Like `lots`, NOT populated by `summarizePortfolio` — the route layer attaches
   * it from the `prices` table after valuing. Undefined/`<2`-length when there isn't enough
   * stored history to draw a line.
   */
  sparkline?: number[];
}

export interface PortfolioSummary {
  displayCurrency: string;
  holdings: HoldingValuation[];
  cash: Record<string, string>;
  /**
   * Whether the cash balance is meaningful: cash is inside the portfolio's boundary
   * (`cashCounted`) AND at least one external funding movement (deposit/withdrawal) was
   * recorded. When `false`, `cash` is empty and excluded from net worth — either because
   * cash is outside the boundary, or because no funding was imported (so a derived balance
   * would be a phantom negative artifact of buys). Lets the UI show "not tracked" vs a real 0.
   */
  cashTracked: boolean;
  netWorth: string;
  totalCost: string;
  totalMarketValue: string;
  totalUnrealizedPnL: string;
  totalRealizedPnL: string;
  /** Outstanding loan liabilities in the display currency (subtracted from net worth). */
  totalLiabilities: string;
  /** Cash income received — dividends, bond coupons and cash interest, net of fees (via `cashFlow()`; don't subtract fees again) — in the display currency. */
  totalIncome: string;
  /** Sum of per-holding day change, in the display currency. */
  totalDayChange: string;
  /**
   * Wealth denominated in each currency — keyed by the asset's own currency
   * (instrument currency for holdings, balance currency for cash), with each
   * value converted to the display currency for comparable magnitudes.
   */
  exposureByCurrency: Record<string, string>;
  /**
   * Currencies (sorted) that hold some of this portfolio's value — a holding's quote/cost
   * currency, a cash balance, income or a liability — but have no known FX rate into the
   * display currency (audit B2). Everything denominated in them is excluded from the
   * display-currency totals above, so those totals are incomplete whenever this is
   * non-empty; the daily snapshot job skips the portfolio rather than persisting them.
   * Empty when every rate resolved.
   */
  fxMissingCurrencies: string[];
}

export interface SummarizeInput {
  transactions: CoreTransaction[];
  corporateActions?: CorporateAction[];
  /** Latest price + currency (+ prior close) keyed by instrument id. */
  prices: Record<string, { price: string; currency: string; previousClose?: string | null }>;
  displayCurrency: string;
  fx?: FxRateFn;
  /** Cost-basis presentation for financed holdings. Defaults to "purchase_price". */
  costBasisMode?: CostBasisMode;
  /**
   * Whether cash is inside this portfolio's investment boundary (see CLAUDE.md
   * "one boundary per portfolio"). When `false` (cash-outside: mixed/invest-only),
   * uninvested cash is excluded from net worth and the cash map is emptied, so the
   * value reflects the securities sleeve only. Defaults to `true`.
   */
  cashCounted?: boolean;
}

export interface NetWorthInputsArgs {
  transactions: CoreTransaction[];
  /** The portfolio's boundary flag (`portfolios.cashCounted`). */
  cashCounted: boolean;
  displayCurrency: string;
  fx: FxRateFn;
  /** FX-availability probe (audit B2). Defaults to "rate known for this currency". */
  canConvert?: (ccy: string) => boolean;
}

export interface NetWorthInputs {
  /** Native cash balances by currency — `{}` unless cash is inside the boundary AND tracked. */
  cash: Record<string, string>;
  /** Cash is inside the boundary and at least one explicit cash-account movement exists. */
  cashTracked: boolean;
  /** The subset of `cash` whose currency converts to `displayCurrency` — what net worth sums. */
  convertibleCash: Record<string, string>;
  /** Outstanding loan principal, in `displayCurrency` (unconvertible currencies left out). */
  liabilities: string;
}

/**
 * The non-securities half of the net-worth definition — the cash that counts and the
 * liabilities that are subtracted — shared by the live valuation ({@link summarizePortfolio})
 * and the historical backfill (`writeSnapshotSeries`), which upsert the same
 * `portfolio_snapshots` rows. Before audit B6 the backfill had its own inline copy with no
 * cash-tracking gate and no liabilities, so a day's stored value flipped definition
 * depending on which job wrote it last. Pass the transactions as of the valuation date.
 *
 * Cash is part of net worth only when it is inside the portfolio's boundary AND actually
 * tracked — i.e. at least one explicit cash-account movement was imported: an external
 * deposit/withdrawal, a financing leg (loan drawdown/repayment, whose negative cash
 * legitimately captures out-of-pocket financing cost), or a manual adjustment. For
 * cash-outside portfolios, or cash-inside ones whose only cash effects are plain
 * securities buys/sells, the value is the securities sleeve only — this avoids the
 * phantom negative-cash artifact when buys are imported without their funding deposits.
 */
export function netWorthInputs(args: NetWorthInputsArgs): NetWorthInputs {
  const canConvert =
    args.canConvert ?? ((ccy: string) => fxAvailable(ccy, args.displayCurrency, args.fx));
  const hasCashMovement = args.transactions.some(
    (tx) =>
      tx.type === "deposit" ||
      tx.type === "withdrawal" ||
      tx.type === "loan_drawdown" ||
      tx.type === "loan_repayment" ||
      // A manual cash true-up is itself an explicit cash-account movement — it should
      // switch on cash tracking the same as a deposit/withdrawal would.
      tx.type === "adjustment",
  );
  const cashTracked = args.cashCounted && hasCashMovement;
  const cash = cashTracked ? cashBalances(args.transactions) : {};
  const convertibleCash: Record<string, string> = {};
  for (const [ccy, amount] of Object.entries(cash)) {
    if (canConvert(ccy)) convertibleCash[ccy] = amount;
  }
  let liabilities = new Decimal(0);
  for (const [ccy, amount] of Object.entries(liabilityBalances(args.transactions))) {
    if (!canConvert(ccy)) continue;
    liabilities = liabilities.add(convert(amount, ccy, args.displayCurrency, args.fx));
  }
  return { cash, cashTracked, convertibleCash, liabilities: liabilities.toString() };
}

/**
 * Full portfolio valuation: per-holding market value + unrealized P&L, cash
 * balances, net worth and totals — all expressed in the display currency.
 * Holdings without a price are returned but excluded from market-value totals.
 */
export function summarizePortfolio(input: SummarizeInput): PortfolioSummary {
  const fx: FxRateFn = input.fx ?? (() => "1");
  const holdings = computeHoldings(input.transactions, input.corporateActions);

  // Audit B2: a currency with no known rate into the display currency is never
  // converted 1:1. Probe each currency once; amounts in a missing one are flagged and
  // left out of the display-currency totals instead.
  const fxMissing = new Set<string>();
  const canConvert = (ccy: string): boolean => {
    if (fxMissing.has(ccy)) return false;
    if (fxAvailable(ccy, input.displayCurrency, fx)) return true;
    fxMissing.add(ccy);
    return false;
  };

  // Total-paid cost basis adds financing incurred to date onto the purchase
  // price; purchase-price mode leaves cost basis untouched.
  const financing =
    input.costBasisMode === "total_paid" ? financingByInstrument(input.transactions) : {};
  const effectiveCost = (h: Holding): Decimal => {
    const fin = financing[h.instrumentId];
    return fin ? new Decimal(h.costBasis).add(fin) : new Decimal(h.costBasis);
  };

  let totalCost = new Decimal(0);
  let totalMarketValue = new Decimal(0);
  let totalRealized = new Decimal(0);
  let totalDayChange = new Decimal(0);
  const exposure: Record<string, Decimal> = {};
  const addExposure = (ccy: string, amountDisplay: string) => {
    exposure[ccy] = (exposure[ccy] ?? new Decimal(0)).add(amountDisplay);
  };

  const valuations: HoldingValuation[] = holdings.map((h) => {
    const quote = input.prices[h.instrumentId];
    // Split cost vs quote currency so cross-currency holdings (e.g. a US stock
    // bought in EUR) are converted correctly. Market value uses the quote currency;
    // cost basis and realized P&L use the cost currency (the trade currency).
    const quoteCcy = quote?.currency ?? input.displayCurrency;
    const costCcy = h.costCurrency ?? quoteCcy;

    // Effective (mode-dependent) cost basis and the derived average cost.
    const cb = effectiveCost(h);
    const cbStr = cb.toString();
    const qty = new Decimal(h.quantity);
    const avgCost = qty.isZero() ? h.avgCost : cb.div(qty).toString();

    // Either currency unconvertible → nothing about this holding can be expressed in
    // the display currency. Same shape as the "nothing to value" branch below, plus
    // the flag; excluded from every total (realized P&L included).
    const quoteOk = quote ? canConvert(quoteCcy) : true;
    const costOk = canConvert(costCcy);
    if (!quoteOk || !costOk) {
      return {
        ...h,
        costBasis: cbStr,
        avgCost,
        price: quote?.price ?? null,
        currency: quote?.currency ?? null,
        marketValue: quote ? marketValue(h.quantity, quote.price) : null,
        unrealizedPnL: null,
        marketValueDisplay: null,
        costBasisDisplay: cbStr,
        unrealizedPnLDisplay: null,
        previousClose: quote?.previousClose ?? null,
        dayChange: null,
        dayChangePct: null,
        fxMissing: true,
      };
    }

    totalRealized = totalRealized.add(
      new Decimal(convert(h.realizedPnL, costCcy, input.displayCurrency, fx)),
    );

    if (!quote) {
      if (h.costCurrency) {
        // No usable market price, but a real cost basis to fall back to — value at
        // cost instead of 0 (issue #744). totalCost/totalMarketValue/exposure all
        // advance together so this holding contributes exactly 0 to totalUnrealizedPnL,
        // not a phantom loss of its whole cost basis. price/dayChange/dayChangePct stay
        // null — genuinely unknown, not 0.
        const costBasisDisplay = convert(cbStr, h.costCurrency, input.displayCurrency, fx);
        totalCost = totalCost.add(new Decimal(costBasisDisplay));
        totalMarketValue = totalMarketValue.add(new Decimal(costBasisDisplay));
        addExposure(h.costCurrency, costBasisDisplay);
        return {
          ...h,
          costBasis: cbStr,
          avgCost,
          price: null,
          currency: null,
          marketValue: null,
          unrealizedPnL: null,
          marketValueDisplay: costBasisDisplay,
          costBasisDisplay,
          unrealizedPnLDisplay: "0",
          previousClose: null,
          dayChange: null,
          dayChangePct: null,
          valuedAtCost: true,
        };
      }
      // No price AND no cost currency at all (e.g. a pure-dividend row, or a zero-price
      // transfer_in with no basis filled in yet — #736's known limitation) — genuinely
      // nothing to value. Matches netWorth()'s own `h.costCurrency` guard.
      return {
        ...h,
        costBasis: cbStr,
        avgCost,
        price: null,
        currency: null,
        marketValue: null,
        unrealizedPnL: null,
        marketValueDisplay: null,
        costBasisDisplay: cbStr,
        unrealizedPnLDisplay: null,
        previousClose: null,
        dayChange: null,
        dayChangePct: null,
      };
    }

    const mv = marketValue(h.quantity, quote.price);
    // Unrealized in native units: market value (quote ccy) minus cost basis (cost ccy).
    // We convert both to display first, then subtract — the display-currency amounts are
    // comparable regardless of whether cost ccy and quote ccy differ.
    const marketValueDisplay = convert(mv, quoteCcy, input.displayCurrency, fx);
    const costBasisDisplay = convert(cbStr, costCcy, input.displayCurrency, fx);
    const unrealizedPnLDisplay = new Decimal(marketValueDisplay)
      .sub(new Decimal(costBasisDisplay))
      .toString();
    // Native-currency unrealized is meaningful only when cost ccy == quote ccy;
    // leave it as the raw difference for same-currency positions (unchanged), and
    // use the display-currency figure for cross-currency ones (best approximation).
    const unrealized =
      costCcy === quoteCcy ? new Decimal(mv).sub(cb).toString() : unrealizedPnLDisplay;
    totalCost = totalCost.add(new Decimal(costBasisDisplay));
    totalMarketValue = totalMarketValue.add(new Decimal(marketValueDisplay));
    addExposure(quoteCcy, marketValueDisplay);

    // Day change needs a non-zero prior close; otherwise it's simply unknown.
    const prev =
      quote.previousClose != null && !new Decimal(quote.previousClose).isZero()
        ? new Decimal(quote.previousClose)
        : null;
    let dayChange: string | null = null;
    let dayChangePct: string | null = null;
    if (prev) {
      const priceDelta = new Decimal(quote.price).sub(prev);
      const rawPct = priceDelta.div(prev).mul(100);
      // Sanity gate: daily moves beyond ±SINGLE_DAY_MAX_PCT are data artifacts
      // (stale previousClose, Yahoo API unit mismatch), not real market moves.
      // Null both fields and exclude from totals to prevent a single bad holding
      // from distorting portfolio-level day-% (which is currency-derived from
      // totalDayChange).  See sanity-gates.ts for the threshold rationale.
      if (rawPct.abs().gt(SINGLE_DAY_MAX_PCT)) {
        if (typeof process !== "undefined") {
          process.stderr.write(
            JSON.stringify({
              level: "warn",
              msg: "[valuation] skipped implausible day change",
              symbol: h.instrumentId,
              pct: rawPct.toNumber(),
              priceDelta: priceDelta.toString(),
            }) + "\n",
          );
        }
        dayChange = null;
        dayChangePct = null;
      } else {
        dayChange = priceDelta.mul(h.quantity).toString();
        dayChangePct = rawPct.toString();
        totalDayChange = totalDayChange.add(
          new Decimal(convert(dayChange, quoteCcy, input.displayCurrency, fx)),
        );
      }
    }

    return {
      ...h,
      costBasis: cbStr,
      avgCost,
      price: quote.price,
      currency: quote.currency,
      marketValue: mv,
      unrealizedPnL: unrealized,
      marketValueDisplay,
      costBasisDisplay,
      unrealizedPnLDisplay,
      previousClose: quote.previousClose ?? null,
      dayChange,
      dayChangePct,
    };
  });

  const { cash, cashTracked, convertibleCash, liabilities } = netWorthInputs({
    transactions: input.transactions,
    cashCounted: input.cashCounted ?? true,
    displayCurrency: input.displayCurrency,
    fx,
    canConvert,
  });
  // Cash in an unconvertible currency stays in `cash` (native amounts) but is left
  // out of exposure and net worth (audit B2).
  for (const [ccy, amount] of Object.entries(convertibleCash)) {
    addExposure(ccy, convert(amount, ccy, input.displayCurrency, fx));
  }
  const fxMissingIds = new Set(valuations.filter((v) => v.fxMissing).map((v) => v.instrumentId));
  const nw = netWorth({
    holdings: holdings.filter((h) => !fxMissingIds.has(h.instrumentId)),
    prices: input.prices,
    cash: convertibleCash,
    displayCurrency: input.displayCurrency,
    fx,
    liabilities,
  });

  let totalIncome = new Decimal(0);
  for (const tx of input.transactions) {
    const isDivOrCoup = tx.type === "dividend" || tx.type === "coupon" || tx.type === "interest";
    if (isDivOrCoup && canConvert(tx.currency)) {
      totalIncome = totalIncome.add(
        convert(cashFlow(tx).toString(), tx.currency, input.displayCurrency, fx),
      );
    }
  }

  return {
    displayCurrency: input.displayCurrency,
    holdings: valuations,
    cash,
    cashTracked,
    netWorth: nw,
    totalCost: totalCost.toString(),
    totalMarketValue: totalMarketValue.toString(),
    totalUnrealizedPnL: totalMarketValue.sub(totalCost).toString(),
    totalRealizedPnL: totalRealized.toString(),
    totalLiabilities: liabilities,
    totalIncome: totalIncome.toString(),
    totalDayChange: totalDayChange.toString(),
    exposureByCurrency: Object.fromEntries(
      Object.entries(exposure).map(([k, v]) => [k, v.toString()]),
    ),
    fxMissingCurrencies: [...fxMissing].sort(),
  };
}

/**
 * Combine several already-valued portfolio summaries (all expressed in the same
 * display currency) into one: holdings merged by instrument, cash by currency,
 * and totals summed. Net worth across portfolios.
 */
export function aggregatePortfolios(
  summaries: PortfolioSummary[],
  displayCurrency: string,
): PortfolioSummary {
  const holdings = new Map<string, HoldingValuation>();
  const cash: Record<string, string> = {};
  const exposure: Record<string, string> = {};
  const fxMissingCurrencies = new Set<string>();
  let totalCost = new Decimal(0);
  let totalMarketValue = new Decimal(0);
  let totalRealized = new Decimal(0);
  let totalIncome = new Decimal(0);
  let totalDayChange = new Decimal(0);
  let totalLiabilities = new Decimal(0);
  let netWorth = new Decimal(0);

  const addNullable = (a: string | null, b: string | null): string | null => {
    if (a === null) return b;
    if (b === null) return a;
    return new Decimal(a).add(b).toString();
  };

  for (const s of summaries) {
    netWorth = netWorth.add(s.netWorth);
    for (const c of s.fxMissingCurrencies ?? []) fxMissingCurrencies.add(c);
    totalCost = totalCost.add(s.totalCost);
    totalMarketValue = totalMarketValue.add(s.totalMarketValue);
    totalRealized = totalRealized.add(s.totalRealizedPnL);
    totalIncome = totalIncome.add(s.totalIncome);
    totalDayChange = totalDayChange.add(s.totalDayChange);
    totalLiabilities = totalLiabilities.add(s.totalLiabilities);

    for (const [currency, amount] of Object.entries(s.cash)) {
      cash[currency] = new Decimal(cash[currency] ?? "0").add(amount).toString();
    }

    for (const [currency, amount] of Object.entries(s.exposureByCurrency)) {
      exposure[currency] = new Decimal(exposure[currency] ?? "0").add(amount).toString();
    }

    for (const h of s.holdings) {
      const ex = holdings.get(h.instrumentId);
      if (!ex) {
        holdings.set(h.instrumentId, { ...h });
        continue;
      }
      const qty = new Decimal(ex.quantity).add(h.quantity);
      const costBasis = new Decimal(ex.costBasis).add(h.costBasis);
      holdings.set(h.instrumentId, {
        instrumentId: h.instrumentId,
        quantity: qty.toString(),
        avgCost: qty.isZero() ? "0" : costBasis.div(qty).toString(),
        costBasis: costBasis.toString(),
        realizedPnL: new Decimal(ex.realizedPnL).add(h.realizedPnL).toString(),
        costCurrency: h.costCurrency ?? ex.costCurrency,
        price: h.price ?? ex.price,
        currency: h.currency ?? ex.currency,
        marketValue: addNullable(ex.marketValue, h.marketValue),
        unrealizedPnL: addNullable(ex.unrealizedPnL, h.unrealizedPnL),
        // Display fields are all in `displayCurrency`, so summing is valid here
        // (unlike the native marketValue/costBasis above).
        marketValueDisplay: addNullable(ex.marketValueDisplay, h.marketValueDisplay),
        costBasisDisplay: new Decimal(ex.costBasisDisplay).add(h.costBasisDisplay).toString(),
        unrealizedPnLDisplay: addNullable(ex.unrealizedPnLDisplay, h.unrealizedPnLDisplay),
        // Same instrument → same per-share price/prev-close, so the percentage is
        // shared; quantities sum, so the absolute day change adds.
        previousClose: h.previousClose ?? ex.previousClose,
        dayChange: addNullable(ex.dayChange, h.dayChange),
        dayChangePct: h.dayChangePct ?? ex.dayChangePct,
        // Two portfolios holding the same instrument could disagree (one still has a
        // usable price, the other doesn't) — true if EITHER contributed an at-cost
        // valuation, so the merged total is flagged whenever any part of it is.
        valuedAtCost: ex.valuedAtCost || h.valuedAtCost || undefined,
        // Same OR-merge as valuedAtCost: the merged display figures omit any part whose
        // FX rate was missing, so flag the merged holding if either side was.
        fxMissing: ex.fxMissing || h.fxMissing || undefined,
        // Merge lots from both portfolios (acquisition order, oldest first). Undefined
        // on both sides stays undefined; either side present yields a merged array.
        lots:
          ex.lots || h.lots
            ? [...(ex.lots ?? []), ...(h.lots ?? [])].sort((a, b) =>
                a.acqDate < b.acqDate ? -1 : a.acqDate > b.acqDate ? 1 : 0,
              )
            : undefined,
      });
    }
  }

  return {
    displayCurrency,
    holdings: [...holdings.values()],
    cash,
    // The aggregate cash figure is meaningful as long as at least one portfolio tracks
    // cash; untracked portfolios contribute an empty cash map, so they don't distort it.
    cashTracked: summaries.some((s) => s.cashTracked),
    netWorth: netWorth.toString(),
    totalCost: totalCost.toString(),
    totalMarketValue: totalMarketValue.toString(),
    totalUnrealizedPnL: totalMarketValue.sub(totalCost).toString(),
    totalRealizedPnL: totalRealized.toString(),
    totalLiabilities: totalLiabilities.toString(),
    totalIncome: totalIncome.toString(),
    totalDayChange: totalDayChange.toString(),
    exposureByCurrency: exposure,
    fxMissingCurrencies: [...fxMissingCurrencies].sort(),
  };
}
