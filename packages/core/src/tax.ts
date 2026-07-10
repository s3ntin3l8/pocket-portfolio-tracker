/**
 * German tax optimization helpers — Sparerpauschbetrag (§20 EStG) headroom tracking
 * and tax-free harvest suggestions.
 *
 * Scope:
 *   - Sparerpauschbetrag: annual investment-income tax-free allowance per holder.
 *   - Teilfreistellung: partial exemption for equity/mixed funds (§20 Abs. 9 InvStG).
 *   - FIFO lot ordering: tax-correct gain attribution (oldest-lot-first disposal).
 *   - Harvest suggestions: open positions whose tf-adjusted gain fits the remaining allowance.
 *   - Vorabpauschale (§18(3) InvStG): trade-log.ts owns the share-accounting side (per-
 *     instrument accrual pool + disposal credit — see Trade.vorabByYear/TradeLeg.vorabCredit);
 *     this module owns the tax-netting side (Teilfreistellung, applied per-instrument in the
 *     same loop that tf-adjusts realized gains, then netted into the FSA usage below).
 *
 * Explicitly OUT OF SCOPE: Verlustverrechnungstopf, church-tax surtax calculation,
 * cross-year loss carry-forward, Günstigerprüfung.
 *
 * All money amounts are Decimal strings (never floats). Caller supplies:
 *   - A merged TradeLog computed with method:"fifo"
 *   - Teilfreistellung rates per instrument (0–1; 0 = no exemption)
 *   - The holder's annual allowance and tax year
 */

import { Decimal } from "decimal.js";
import type { TradeLog, Trade, YearTax } from "./trade-log.js";

const D = (v: string | number) => new Decimal(v);
const ZERO = new Decimal(0);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** YTD usage of the annual tax-free allowance (Sparerpauschbetrag). */
export interface AllowanceUsage {
  /** Calendar year this covers. */
  year: number;
  /** Holder's annual allowance (from DB; never hard-coded). */
  allowanceAnnual: string;
  /** Tf-adjusted realized gains from FIFO lots closed this year (display currency). */
  realizedGainsAdjusted: string;
  /** Gross dividend/interest/coupon income this year (net received + withholding, display currency). */
  incomeYtd: string;
  /**
   * Tf-adjusted Vorabpauschale accrued this year (§18(3) InvStG advance lump-sum fund tax),
   * from Trade.vorabByYear, tf-adjusted per-instrument (display currency, never negative).
   */
  vorabpauschaleAccrued: string;
  /**
   * Tf-adjusted Vorabpauschale disposal credit realized this year (from TradeLeg.vorabCredit
   * on sells closed this year) — money already taxed via a prior accrual, credited back
   * against double-taxation on disposal (display currency, never negative).
   */
  vorabpauschaleCredited: string;
  /**
   * Total used = realizedGainsAdjusted + incomeYtd + (vorabpauschaleAccrued −
   * vorabpauschaleCredited), clamped to [0, allowanceAnnual]. The Vorabpauschale term may be
   * negative (a credit exceeding this year's accrual, e.g. disposing a position whose
   * Vorabpauschale accrued in a prior year) — that correctly REDUCES usedYtd.
   */
  usedYtd: string;
  /** remaining = allowanceAnnual − usedYtd (never negative). */
  remaining: string;
  /** Effective Kapitalertragsteuer rate (default 0.25, configured per-holder). */
  taxRate: string;
  /** Tax saved by using the allowance = remaining × taxRate (informational). */
  taxSavingAvailable: string;
  /** Currency of all monetary amounts (= the TradeLog displayCurrency). */
  currency: string;

  // --- Forecast (rest-of-year projected income) ---

  /**
   * Gross projected income for the remainder of the current year (equity dividends +
   * bond coupons, grossed up to match the Sparerpauschbetrag convention).
   * "0.00" when the requested year is not the current year or no projection is available.
   */
  forecastIncomeRestOfYear: string;
  /**
   * Projected full-year used = clamp(realizedGainsAdjusted + incomeYtd + forecastIncomeRestOfYear,
   * 0, allowanceAnnual).  Equals usedYtd when forecastIncomeRestOfYear is zero.
   */
  projectedUsedFullYear: string;
  /** projectedRemaining = allowanceAnnual − projectedUsedFullYear (never negative). */
  projectedRemaining: string;
  /** Estimated tax saving against the projected remaining = projectedRemaining × taxRate. */
  projectedTaxSavingAvailable: string;
}

/** A single harvest suggestion: one open position that could be (partially) realized tax-free. */
export interface HarvestSuggestion {
  instrumentId: string;
  /** Gross unrealized gain of the WHOLE open position (display currency, from TradeLog). */
  unrealizedGross: string;
  /** Tf rate applied (0–1). */
  tfRate: string;
  /** Tf-adjusted unrealized gain = unrealizedGross × (1 − tfRate). */
  unrealizedAdjusted: string;
  /**
   * How much gross gain you can realize tax-free given the remaining allowance.
   * = min(unrealizedGross, remaining / (1 − tfRate))
   * When tfRate = 1 (full exemption), the full position is harvestable; we return
   * unrealizedGross directly.
   */
  harvestableGross: string;
  /**
   * Tax saved if you realize exactly `harvestableGross` = min(unrealizedAdjusted,
   * remaining) × taxRate.
   */
  taxSaving: string;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface AllowanceUsageInput {
  /** FIFO trade log (must have been computed with method:"fifo"). */
  tradeLog: TradeLog;
  /**
   * Tf rates keyed by instrumentId. Only instruments with assetClass etf or
   * mutual_fund should have a non-zero rate; everything else defaults to 0.
   * Values are in [0, 1].
   */
  tfRates: Record<string, string | number>;
  /**
   * Annual Sparerpauschbetrag for this holder (e.g. "1000" for €1,000).
   * Must come from the DB; never hard-code.
   */
  allowanceAnnual: string;
  /**
   * KapSt rate (e.g. "0.25" for 25%). Caller should store this in the DB.
   * Default: "0.25".
   */
  taxRate?: string;
  /** Tax year to compute. Defaults to the current UTC calendar year. */
  year?: number;
  /**
   * Gross projected income (equity dividends + bond coupons) for the rest of
   * the current year, in the TradeLog displayCurrency.  Must already be grossed
   * up to match the Sparerpauschbetrag convention (gross = net + withholding).
   *
   * Pass "0" (or omit) when the requested year differs from the current calendar
   * year, or when no forecast is available.
   */
  forecastIncomeRestOfYear?: string;
}

export interface HarvestSuggestionsInput extends AllowanceUsageInput {
  /** Pre-computed allowance usage. If omitted it is computed from the tradeLog. */
  usage?: AllowanceUsage;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Compute YTD Sparerpauschbetrag usage for a holder.
 *
 * Algorithm:
 *   1. Walk every CLOSED trade; for each leg whose taxYear === year, tf-adjust the gain
 *      (gain × (1 − tfRate)).  Accumulate per-trade (keyed by instrumentId). In the same
 *      per-trade loop (same instrumentId, same tfRate), tf-adjust this year's Vorabpauschale
 *      accrual (Trade.vorabByYear) and this year's disposal credit (Σ leg.vorabCredit) —
 *      Vorabpauschale needs a per-instrument rate exactly like gains do; there is no single
 *      correct blended rate across funds.
 *   2. Sum dividendsByYear for `year` (gross = net + withholding; includes interest/coupons).
 *   3. used = tf-adjusted gains + income + (tf-adjusted accrual − tf-adjusted credit),
 *      clamped to [0, allowanceAnnual].
 *   4. remaining = allowanceAnnual − used.
 */
export function allowanceUsageYTD(input: AllowanceUsageInput): AllowanceUsage {
  const year = input.year ?? new Date().getUTCFullYear();
  const allowance = D(input.allowanceAnnual);
  const taxRate = D(input.taxRate ?? "0.25");
  const currency = input.tradeLog.displayCurrency;

  // Step 1: tf-adjusted realized gains from closed FIFO legs this year, plus tf-adjusted
  // Vorabpauschale accrual/disposal-credit for the same instrument (same tfRate).
  let realizedAdjusted = ZERO;
  let vorabAccrued = ZERO;
  let vorabCredited = ZERO;
  for (const trade of input.tradeLog.trades) {
    const tfRaw = input.tfRates[trade.instrumentId];
    const tfRate = tfRaw !== undefined ? D(tfRaw) : ZERO;
    const multiplier = Decimal.max(ZERO, D(1).minus(tfRate));

    for (const leg of trade.legs) {
      if (leg.taxYear !== year) continue;
      const gain = D(leg.gain);
      // Only count POSITIVE gains against the allowance (losses can't eat the allowance).
      if (gain.gt(ZERO)) {
        realizedAdjusted = realizedAdjusted.plus(gain.times(multiplier));
      }
      // Applied unconditionally on `gain`'s sign (unlike realizedAdjusted, which only
      // counts positive gains): a disposal credit is real even on a loss-making sell — it
      // still reduces usedYtd, which on a loss leg means it nets against OTHER income
      // rather than against this trade's own (excluded) loss. That cross-trade netting is
      // Verlustverrechnungstopf territory (Workstream 3) — deliberately not modeled here;
      // doesn't manifest in the validated real data (the one accrual/credit pair was a gain).
      const credit = D(leg.vorabCredit ?? "0");
      if (credit.gt(ZERO)) {
        vorabCredited = vorabCredited.plus(credit.times(multiplier));
      }
    }

    for (const va of trade.vorabByYear ?? []) {
      if (va.year !== year) continue;
      const amt = D(va.amount);
      if (amt.gt(ZERO)) {
        vorabAccrued = vorabAccrued.plus(amt.times(multiplier));
      }
    }
  }

  // Step 2: gross income this year (dividends + interest + coupons) from dividendsByYear.
  // YearTax.amount is net-received; .tax is the withheld amount.  The Sparerpauschbetrag
  // is consumed by GROSS Kapitalerträge (§20 EStG), so we must add withholding back.
  const incomeEntry: YearTax | undefined = input.tradeLog.dividendsByYear.find(
    (e) => e.year === year,
  );
  const incomeGross = incomeEntry
    ? D(incomeEntry.amount).plus(D(incomeEntry.tax))
    : ZERO;
  const positiveIncome = Decimal.max(ZERO, incomeGross);

  // Step 3: total used, clamped to [0, allowance]. The accrual/credit net (vorabAccrued −
  // vorabCredited) may be negative — a disposal credit exceeding this year's accrual (e.g.
  // selling a position whose Vorabpauschale accrued in a prior year) correctly REDUCES
  // usedYtd, same mechanism as TR crediting the accumulated base against a sale's gain.
  const vorabNet = vorabAccrued.minus(vorabCredited);
  const rawUsed = realizedAdjusted.plus(positiveIncome).plus(vorabNet);
  const usedYtd = Decimal.min(Decimal.max(ZERO, rawUsed), allowance);

  // Step 4: remaining.
  const remaining = Decimal.max(ZERO, allowance.minus(usedYtd));

  // Tax saving available = remaining × taxRate (before Soli etc.).
  const taxSavingAvailable = remaining.times(taxRate);

  // Step 5: forward projection (rest-of-year forecast, already grossed up by caller).
  const forecastGross = Decimal.max(ZERO, D(input.forecastIncomeRestOfYear ?? "0"));
  const rawProjected = rawUsed.plus(forecastGross);
  const projectedUsedFullYear = Decimal.min(Decimal.max(ZERO, rawProjected), allowance);
  const projectedRemaining = Decimal.max(ZERO, allowance.minus(projectedUsedFullYear));
  const projectedTaxSavingAvailable = projectedRemaining.times(taxRate);

  return {
    year,
    allowanceAnnual: allowance.toFixed(2),
    realizedGainsAdjusted: realizedAdjusted.toFixed(2),
    incomeYtd: positiveIncome.toFixed(2),
    vorabpauschaleAccrued: vorabAccrued.toFixed(2),
    vorabpauschaleCredited: vorabCredited.toFixed(2),
    usedYtd: usedYtd.toFixed(2),
    remaining: remaining.toFixed(2),
    taxRate: taxRate.toString(),
    taxSavingAvailable: taxSavingAvailable.toFixed(2),
    currency,
    forecastIncomeRestOfYear: forecastGross.toFixed(2),
    projectedUsedFullYear: projectedUsedFullYear.toFixed(2),
    projectedRemaining: projectedRemaining.toFixed(2),
    projectedTaxSavingAvailable: projectedTaxSavingAvailable.toFixed(2),
  };
}

/**
 * Generate harvest suggestions: open positions ordered by descending tf-adjusted
 * unrealized gain, each showing how much could be realized tax-free against the
 * remaining allowance.
 *
 * Suggestions are INDEPENDENT — each is evaluated against the same `remaining`
 * value; no sequential allocation is done (the user decides which to act on).
 * Only positions with a positive unrealized gain are returned.
 */
export function harvestSuggestions(input: HarvestSuggestionsInput): HarvestSuggestion[] {
  const usage =
    input.usage ??
    allowanceUsageYTD({
      tradeLog: input.tradeLog,
      tfRates: input.tfRates,
      allowanceAnnual: input.allowanceAnnual,
      taxRate: input.taxRate,
      year: input.year,
    });

  // Use projectedRemaining when available (accounts for rest-of-year forecast income).
  // Falls back to realized remaining when the forecast is zero (backward-compatible).
  const remaining = D(usage.projectedRemaining ?? usage.remaining);
  const taxRate = D(usage.taxRate);

  if (remaining.lte(ZERO)) return [];

  const suggestions: HarvestSuggestion[] = [];

  for (const trade of input.tradeLog.trades) {
    if (trade.status !== "open") continue;

    const grossGain = D(trade.unrealizedPnL);
    if (grossGain.lte(ZERO)) continue; // only harvestable when in profit

    const tfRaw = input.tfRates[trade.instrumentId];
    const tfRate = tfRaw !== undefined ? D(tfRaw) : ZERO;

    // Guard against degenerate tfRate = 1 (full exemption — not currently in scope but
    // let's be safe). If tfRate were 1, the adjusted gain would be 0 and harvestable
    // would be the full position.
    const ONE = D(1);
    const exemptFraction = Decimal.min(ONE, Decimal.max(ZERO, tfRate));
    const multiplier = ONE.minus(exemptFraction);

    let adjustedGain: Decimal;
    let harvestableGross: Decimal;

    if (multiplier.isZero()) {
      // Full exemption: entire position is tax-free.
      adjustedGain = ZERO;
      harvestableGross = grossGain;
    } else {
      adjustedGain = grossGain.times(multiplier);
      // harvestableGross = min(grossGain, remaining / multiplier)
      const maxGross = remaining.div(multiplier);
      harvestableGross = Decimal.min(grossGain, maxGross);
    }

    // Tax saving = min(adjustedGain, remaining) × taxRate
    const adjustedCapped = Decimal.min(adjustedGain, remaining);
    const taxSaving = adjustedCapped.times(taxRate);

    suggestions.push({
      instrumentId: trade.instrumentId,
      unrealizedGross: grossGain.toFixed(2),
      tfRate: exemptFraction.toString(),
      unrealizedAdjusted: adjustedGain.toFixed(2),
      harvestableGross: harvestableGross.toFixed(2),
      taxSaving: taxSaving.toFixed(2),
    });
  }

  // Sort by descending tf-adjusted unrealized gain (best harvest opportunity first).
  suggestions.sort((a, b) => D(b.unrealizedAdjusted).cmp(D(a.unrealizedAdjusted)));

  return suggestions;
}

// Re-export Trade type so callers don't need a separate import.
export type { TradeLog, Trade };
