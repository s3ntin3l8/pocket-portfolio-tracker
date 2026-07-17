import { Decimal } from "decimal.js";
import { D, ZERO } from "../decimal.js";
import { effectiveMultiplier, computePotUsage } from "../tax-helpers.js";
import type { YearTax } from "../trade-log.js";
import type { AllowanceUsageInput, AllowanceUsage } from "./types.js";

export function allowanceUsageYTD(input: AllowanceUsageInput): AllowanceUsage {
  const year = input.year ?? new Date().getUTCFullYear();
  const allowance = D(input.allowanceAnnual);
  const taxRate = D(input.taxRate ?? "0.25");
  const currency = input.tradeLog.displayCurrency;
  const assetClasses = input.assetClasses ?? {};

  let stockSubtotal = ZERO;
  let generalTradeSubtotal = ZERO;
  let vorabAccrued = ZERO;
  let vorabCredited = ZERO;
  for (const trade of input.tradeLog.trades) {
    const assetClass = assetClasses[trade.instrumentId];
    if (assetClass === "gold" || assetClass === "crypto") continue;
    const isStock = assetClass === "equity";

    const multiplier = effectiveMultiplier(input.tfRates[trade.instrumentId] ?? "0");

    for (const leg of trade.legs) {
      if (leg.taxYear !== year) continue;
      const adjustedGain = D(leg.gain).times(multiplier);
      if (isStock) stockSubtotal = stockSubtotal.plus(adjustedGain);
      else generalTradeSubtotal = generalTradeSubtotal.plus(adjustedGain);

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

  const incomeEntry: YearTax | undefined = input.tradeLog.dividendsByYear.find(
    (e) => e.year === year,
  );
  const incomeGross = incomeEntry ? D(incomeEntry.amount).plus(D(incomeEntry.tax)) : ZERO;
  const positiveIncome = Decimal.max(ZERO, incomeGross);

  const vorabNet = vorabAccrued.minus(vorabCredited);
  const generalSubtotalNoForecast = generalTradeSubtotal.plus(incomeGross).plus(vorabNet);
  const forecastGross = Decimal.max(ZERO, D(input.forecastIncomeRestOfYear ?? "0"));
  const generalSubtotalWithForecast = generalSubtotalNoForecast.plus(forecastGross);

  const stockCF = Decimal.max(ZERO, D(input.lossCarryForward?.stock ?? "0"));
  const generalCF = Decimal.max(ZERO, D(input.lossCarryForward?.general ?? "0"));
  const stockUsed = computePotUsage(stockSubtotal, input.lossCarryForward?.stock);
  const generalUsedYtd = computePotUsage(
    generalSubtotalNoForecast,
    input.lossCarryForward?.general,
  );
  const generalUsedProjected = computePotUsage(
    generalSubtotalWithForecast,
    input.lossCarryForward?.general,
  );

  const rawUsed = stockUsed.plus(generalUsedYtd);
  const usedYtd = Decimal.min(rawUsed, allowance);
  const remaining = Decimal.max(ZERO, allowance.minus(usedYtd));
  const taxSavingAvailable = remaining.times(taxRate);
  const taxableExcess = Decimal.max(ZERO, rawUsed.minus(allowance));

  const rawProjected = stockUsed.plus(generalUsedProjected);
  const projectedUsedFullYear = Decimal.min(rawProjected, allowance);
  const projectedRemaining = Decimal.max(ZERO, allowance.minus(projectedUsedFullYear));
  const projectedTaxSavingAvailable = projectedRemaining.times(taxRate);

  return {
    year,
    allowanceAnnual: allowance.toFixed(2),
    realizedGainsAdjusted: stockSubtotal.plus(generalTradeSubtotal).toFixed(2),
    incomeYtd: positiveIncome.toFixed(2),
    vorabpauschaleAccrued: vorabAccrued.toFixed(2),
    vorabpauschaleCredited: vorabCredited.toFixed(2),
    stockPot: {
      netGainLoss: stockSubtotal.toFixed(2),
      carryForwardApplied: stockCF.toFixed(2),
      used: stockUsed.toFixed(2),
    },
    generalPot: {
      netGainLoss: generalSubtotalNoForecast.toFixed(2),
      carryForwardApplied: generalCF.toFixed(2),
      used: generalUsedYtd.toFixed(2),
    },
    usedYtd: usedYtd.toFixed(2),
    taxableExcess: taxableExcess.toFixed(2),
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
