import type { Decimal } from "decimal.js";
import type { CoreTransaction, CorporateAction } from "../types.js";
import type { CashFlowPoint } from "../xirr.js";
import type { CostBasisMode } from "../valuation.js";
import type { FxRateFn } from "../networth.js";

export type TradeMethod = "average" | "fifo";

/** A matched disposal slice — FIFO: one consumed lot; average: the whole sell at episode-entry. */
export interface TradeLeg {
  /** Acquisition date of the matched lot (FIFO) or the episode entry (average). */
  acqDate: string; // YYYY-MM-DD
  sellDate: string; // YYYY-MM-DD
  quantity: string;
  cost: string; // display currency
  proceeds: string; // display currency
  gain: string; // display currency
  holdingDays: number;
  longTerm: boolean;
  taxYear: number;
  /** Vorabpauschale drawdown for this slice (§18(3) InvStG disposal credit against
   * double-taxation), display currency, gross (tax.ts applies Teilfreistellung). Optional
   * — omitted on hand-written fixtures predating this field; computeTrades always sets it
   * (defaulting to "0" when no accrual pool exists for the instrument). */
  vorabCredit?: string;
}

export interface Trade {
  instrumentId: string;
  /** Instrument currency — the unit for avgEntryPrice / avgExitPrice. */
  currency: string;
  status: "open" | "closed";
  entryDate: string; // YYYY-MM-DD
  exitDate: string | null; // YYYY-MM-DD, null while open
  holdingDays: number;
  /** Capital-weighted average holding period. Equals `holdingDays` for a single
   * lump-sum buy; shorter than `holdingDays` for savings plans because capital
   * deployed later was invested for less time. Used to reconcile annualized (XIRR)
   * with total return — `totalReturnPct / (avgHoldingDays / 365) ≈ annualizedPct`. */
  avgHoldingDays: number;
  longTerm: boolean;
  /** Open: current units held. Closed: total units acquired over the episode. */
  quantity: string;
  avgEntryPrice: string; // instrument currency, fees excluded
  avgExitPrice: string | null; // instrument currency, fees excluded
  invested: string; // display currency (cost deployed, fees + financing incl.)
  realizedPnL: string; // display currency, method-aware
  unrealizedPnL: string; // display currency (open portion; "0" when closed/unpriced)
  dividends: string; // display currency (instrument income within the holding window)
  totalReturn: string; // realized + unrealized + dividends, display currency
  totalReturnPct: number | null;
  annualizedPct: number | null; // XIRR over the episode's flows + terminal value
  legs: TradeLeg[];
  /** Vorabpauschale accrued during this episode's holding window, gross, bucketed by its
   * deemed-inflow year (display currency; no +1 shift — the source event's own executedAt
   * already reflects the deemed-inflow date, per §18(3) InvStG). tax.ts tf-adjusts and nets
   * this per-instrument (see allowanceUsageYTD). Optional — omitted on hand-written
   * fixtures predating this field; computeTrades always sets it (possibly `[]`). */
  vorabByYear?: YearAmount[];
}

export interface YearAmount {
  year: number;
  amount: string; // display currency
}

export interface YearTax {
  year: number;
  amount: string; // net income received, display currency
  tax: string; // withholding tax, display currency
}

export interface TradeLog {
  displayCurrency: string;
  method: TradeMethod;
  trades: Trade[];
  totalRealized: string;
  totalDividends: string;
  totalReturn: string;
  /** Fraction of closed trades with a positive total return (incl. dividends); null if none closed. */
  winRate: number | null;
  realizedByYear: YearAmount[]; // method-aware (from leg tax years)
  dividendsByYear: YearTax[]; // all income incl. instrument-less interest
  /** Broker-credited bonuses by year: bonus_cash (e.g. Kindergeld), saveback buy legs,
   * and transfer_in free-share receipts. Purely informational — NOT included in
   * totalReturn or totalDividends. Excludes roundup (user's own spare change). */
  bonusesByYear: YearAmount[];
}

export interface ComputeTradesInput {
  transactions: CoreTransaction[];
  corporateActions?: CorporateAction[];
  /** Latest price + currency keyed by instrument id (open-position valuation). */
  prices: Record<string, { price: string; currency: string }>;
  displayCurrency: string;
  fx?: FxRateFn;
  method?: TradeMethod; // default "average"
  costBasisMode?: CostBasisMode; // default "purchase_price"
  now?: Date;
  /** Quantity dust tolerance for episode closure. Default 1e-6. */
  dustEpsilon?: string;
  /** Instrument metadata (specifically assetClass) keyed by instrument id. */
  instruments?: Map<string, { assetClass: string }> | Record<string, { assetClass: string }>;
}

/** A FIFO lot: shares acquired together at a per-unit cost (fees included). */
export interface Lot {
  acqDate: Date;
  qty: Decimal;
  unitCost: Decimal;
}

/** Mutable accumulators for the in-progress episode of one instrument. */
export interface Episode {
  entryDate: Date;
  acqQtyPrice: Decimal; // Σ qty×price (fees excluded) — for avgEntryPrice
  acqQty: Decimal; // Σ acquired qty (restated to current-share terms by splits)
  acqCost: Decimal; // Σ qty×price + fees — invested
  sellQtyPrice: Decimal; // Σ sellqty×price — for avgExitPrice
  soldQty: Decimal;
  realized: Decimal; // method-aware, instrument currency
  legs: TradeLeg[];
  flows: CashFlowPoint[]; // for XIRR, display currency
  vorabByYear: Map<number, Decimal>; // Vorabpauschale accrued this episode, display currency
}

export type Event =
  { kind: "tx"; at: Date; tx: CoreTransaction } | { kind: "ca"; at: Date; ca: CorporateAction };
