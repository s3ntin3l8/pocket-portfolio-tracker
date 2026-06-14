import { Decimal } from "decimal.js";
import { computeHoldings, marketValue } from "./holdings.js";
import { cashBalances } from "./cash.js";
import { netWorth, convert, type FxRateFn } from "./networth.js";
import type { CoreTransaction, CorporateAction, Holding } from "./types.js";

export interface HoldingValuation extends Holding {
  price: string | null;
  currency: string | null;
  marketValue: string | null;
  unrealizedPnL: string | null;
}

export interface PortfolioSummary {
  displayCurrency: string;
  holdings: HoldingValuation[];
  cash: Record<string, string>;
  netWorth: string;
  totalCost: string;
  totalMarketValue: string;
  totalUnrealizedPnL: string;
  totalRealizedPnL: string;
}

export interface SummarizeInput {
  transactions: CoreTransaction[];
  corporateActions?: CorporateAction[];
  /** Latest price + currency keyed by instrument id. */
  prices: Record<string, { price: string; currency: string }>;
  displayCurrency: string;
  fx?: FxRateFn;
}

/**
 * Full portfolio valuation: per-holding market value + unrealized P&L, cash
 * balances, net worth and totals — all expressed in the display currency.
 * Holdings without a price are returned but excluded from market-value totals.
 */
export function summarizePortfolio(input: SummarizeInput): PortfolioSummary {
  const fx: FxRateFn = input.fx ?? (() => "1");
  const holdings = computeHoldings(input.transactions, input.corporateActions);

  let totalCost = new Decimal(0);
  let totalMarketValue = new Decimal(0);
  let totalRealized = new Decimal(0);

  const valuations: HoldingValuation[] = holdings.map((h) => {
    const quote = input.prices[h.instrumentId];
    const currency = quote?.currency ?? input.displayCurrency;

    totalRealized = totalRealized.add(
      new Decimal(convert(h.realizedPnL, currency, input.displayCurrency, fx)),
    );

    if (!quote) {
      return {
        ...h,
        price: null,
        currency: null,
        marketValue: null,
        unrealizedPnL: null,
      };
    }

    const mv = marketValue(h.quantity, quote.price);
    const unrealized = new Decimal(mv).sub(new Decimal(h.costBasis)).toString();
    totalCost = totalCost.add(
      new Decimal(convert(h.costBasis, currency, input.displayCurrency, fx)),
    );
    totalMarketValue = totalMarketValue.add(
      new Decimal(convert(mv, currency, input.displayCurrency, fx)),
    );

    return {
      ...h,
      price: quote.price,
      currency: quote.currency,
      marketValue: mv,
      unrealizedPnL: unrealized,
    };
  });

  const cash = cashBalances(input.transactions);
  const nw = netWorth({
    holdings,
    prices: input.prices,
    cash,
    displayCurrency: input.displayCurrency,
    fx,
  });

  return {
    displayCurrency: input.displayCurrency,
    holdings: valuations,
    cash,
    netWorth: nw,
    totalCost: totalCost.toString(),
    totalMarketValue: totalMarketValue.toString(),
    totalUnrealizedPnL: totalMarketValue.sub(totalCost).toString(),
    totalRealizedPnL: totalRealized.toString(),
  };
}
