import { Decimal } from "decimal.js";
import { D, ZERO } from "../decimal.js";
import { positionHarvestMath } from "../tax-helpers.js";
import { allowanceUsageYTD } from "./compute.js";
import type {
  HarvestSuggestionsInput,
  HarvestSuggestion,
  HarvestSummary,
  HarvestPlanStep,
} from "./types.js";

export function harvestSuggestions(input: HarvestSuggestionsInput): HarvestSuggestion[] {
  const usage =
    input.usage ??
    allowanceUsageYTD({
      tradeLog: input.tradeLog,
      tfRates: input.tfRates,
      allowanceAnnual: input.allowanceAnnual,
      taxRate: input.taxRate,
      year: input.year,
      assetClasses: input.assetClasses,
      lossCarryForward: input.lossCarryForward,
    });

  const remaining = D(usage.projectedRemaining ?? usage.remaining);
  const taxRate = D(usage.taxRate);

  if (remaining.lte(ZERO)) return [];

  const suggestions: HarvestSuggestion[] = [];

  for (const trade of input.tradeLog.trades) {
    if (trade.status !== "open") continue;

    const grossGain = D(trade.unrealizedPnL);
    if (grossGain.lte(ZERO)) continue;

    const tfRaw = input.tfRates[trade.instrumentId];

    const { adjustedGain, harvestableGross, taxSaving } = positionHarvestMath(
      grossGain,
      tfRaw,
      remaining,
      taxRate,
    );

    const exemptFraction = Decimal.min(
      D(1),
      Decimal.max(ZERO, tfRaw !== undefined ? D(tfRaw) : ZERO),
    );

    suggestions.push({
      instrumentId: trade.instrumentId,
      unrealizedGross: grossGain.toFixed(2),
      tfRate: exemptFraction.toString(),
      unrealizedAdjusted: adjustedGain.toFixed(2),
      harvestableGross: harvestableGross.toFixed(2),
      taxSaving: taxSaving.toFixed(2),
    });
  }

  suggestions.sort((a, b) => D(b.unrealizedAdjusted).cmp(D(a.unrealizedAdjusted)));

  return suggestions;
}

export function harvestSummary(
  suggestions: HarvestSuggestion[],
  remaining: string,
  taxRate: string,
): HarvestSummary {
  const rate = D(taxRate);
  let allowanceLeft = D(remaining);
  let combinedGross = ZERO;
  let combinedAdjusted = ZERO;
  const plan: HarvestPlanStep[] = [];

  for (const s of suggestions) {
    const tfRate = D(s.tfRate);
    const ONE = D(1);
    const exemptFraction = Decimal.min(ONE, Decimal.max(ZERO, tfRate));
    const multiplier = ONE.minus(exemptFraction);
    const unrealizedGross = D(s.unrealizedGross);

    if (multiplier.isZero()) {
      combinedGross = combinedGross.plus(unrealizedGross);
      plan.push({
        instrumentId: s.instrumentId,
        grossTake: unrealizedGross.toFixed(2),
        adjustedTake: "0.00",
      });
      continue;
    }

    if (allowanceLeft.lte(ZERO)) continue;

    const adjustedTake = Decimal.min(D(s.unrealizedAdjusted), allowanceLeft);
    if (adjustedTake.lte(ZERO)) continue;

    const grossTake = Decimal.min(unrealizedGross, adjustedTake.div(multiplier));
    combinedGross = combinedGross.plus(grossTake);
    combinedAdjusted = combinedAdjusted.plus(adjustedTake);
    allowanceLeft = allowanceLeft.minus(adjustedTake);
    plan.push({
      instrumentId: s.instrumentId,
      grossTake: grossTake.toFixed(2),
      adjustedTake: adjustedTake.toFixed(2),
    });
  }

  return {
    positionsUsed: plan.length,
    combinedHarvestableGross: combinedGross.toFixed(2),
    combinedTaxSaving: combinedAdjusted.times(rate).toFixed(2),
    plan,
  };
}
