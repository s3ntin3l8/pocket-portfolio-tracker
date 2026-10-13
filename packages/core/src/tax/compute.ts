import { Decimal } from "decimal.js";
import { D, ZERO } from "../decimal.js";
import { effectiveMultiplier, computePotsUsage, isSection23Class } from "../tax-helpers.js";
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
    if (isSection23Class(assetClass)) continue;
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

  // Income pool. dividendsByYear is the gross-able total; the instrument-attributed part
  // (incomeByInstrumentYear) gets that instrument's Teilfreistellung (30% equity ETF,
  // 15% mutual fund, or the per-instrument override) — fund DISTRIBUTIONS are partially
  // exempt just like fund gains. Instrument-less income (e.g. account interest) and
  // fixtures without the per-instrument split stay unadjusted.
  const incomeEntry: YearTax | undefined = input.tradeLog.dividendsByYear.find(
    (e) => e.year === year,
  );
  let incomeGross = incomeEntry ? D(incomeEntry.amount).plus(D(incomeEntry.tax)) : ZERO;
  for (const e of input.tradeLog.incomeByInstrumentYear ?? []) {
    if (e.year !== year) continue;
    const gross = D(e.amount).plus(D(e.tax));
    const exempt = gross.minus(
      gross.times(effectiveMultiplier(input.tfRates[e.instrumentId] ?? "0")),
    );
    incomeGross = incomeGross.minus(exempt);
  }
  const positiveIncome = Decimal.max(ZERO, incomeGross);

  const vorabNet = vorabAccrued.minus(vorabCredited);
  const generalSubtotalNoForecast = generalTradeSubtotal.plus(incomeGross).plus(vorabNet);
  const forecastGross = Decimal.max(ZERO, D(input.forecastIncomeRestOfYear ?? "0"));
  const generalSubtotalWithForecast = generalSubtotalNoForecast.plus(forecastGross);

  const stockCF = Decimal.max(ZERO, D(input.lossCarryForward?.stock ?? "0"));
  const generalCF = Decimal.max(ZERO, D(input.lossCarryForward?.general ?? "0"));
  // One-way loss netting (see computePotsUsage): general-pot losses offset stock gains;
  // stock losses never offset general gains. Projected (with rest-of-year forecast
  // income) is netted separately because the forecast can flip the general pot positive.
  const { stockUsed, generalUsed: generalUsedYtd } = computePotsUsage(
    stockSubtotal,
    generalSubtotalNoForecast,
    input.lossCarryForward,
  );
  const { stockUsed: stockUsedProjected, generalUsed: generalUsedProjected } = computePotsUsage(
    stockSubtotal,
    generalSubtotalWithForecast,
    input.lossCarryForward,
  );

  const rawUsed = stockUsed.plus(generalUsedYtd);
  const usedYtd = Decimal.min(rawUsed, allowance);
  const remaining = Decimal.max(ZERO, allowance.minus(usedYtd));
  const taxSavingAvailable = remaining.times(taxRate);
  const taxableExcess = Decimal.max(ZERO, rawUsed.minus(allowance));

  const rawProjected = stockUsedProjected.plus(generalUsedProjected);
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
