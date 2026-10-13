import { Decimal } from "decimal.js";
import { D, ZERO } from "./decimal.js";

/** Gold and crypto are §23 EStG private-sale assets — outside the §20 Sparerpauschbetrag. */
export function isSection23Class(assetClass: string | undefined): boolean {
  return assetClass === "gold" || assetClass === "crypto";
}

export function effectiveMultiplier(tfRate: string | number): Decimal {
  return Decimal.max(ZERO, D(1).minus(D(tfRate)));
}

/**
 * Net the two loss pots (§20 Abs. 6 EStG) and return what counts against the allowance.
 *
 * Direction rule (owner-confirmed, one-way): a loss in the GENERAL pot offsets STOCK
 * gains; a loss in the STOCK pot (Aktienverlusttopf) only ever offsets stock gains,
 * never general gains. Each pot first absorbs its own carry-forward; whatever is
 * negative afterwards is carried forward separately (nothing here consumes it).
 *
 *   stock / general -> used
 *   +1000 / -400    -> 600   (general loss nets the stock gain)
 *   -1000 / +400    -> 400   (stock loss not used against the general gain)
 *   -400  / +1000   -> 1000
 *   +400  / -1000   -> 0     (600 of general loss carried forward)
 */
export function computePotsUsage(
  stockSubtotal: Decimal,
  generalSubtotal: Decimal,
  carryForward?: { stock?: string; general?: string },
): { stockUsed: Decimal; generalUsed: Decimal } {
  const stockNet = stockSubtotal.minus(Decimal.max(ZERO, D(carryForward?.stock ?? "0")));
  const generalNet = generalSubtotal.minus(Decimal.max(ZERO, D(carryForward?.general ?? "0")));
  const stockGain = Decimal.max(ZERO, stockNet);
  if (generalNet.gte(ZERO)) return { stockUsed: stockGain, generalUsed: generalNet };
  // Negative general pot: absorbs stock gains only (never flows the other way).
  const offset = Decimal.min(stockGain, generalNet.neg());
  return { stockUsed: stockGain.minus(offset), generalUsed: ZERO };
}

export function positionHarvestMath(
  grossGain: Decimal,
  tfRateRaw: string | number | undefined,
  remaining: Decimal,
  taxRate: Decimal,
): {
  adjustedGain: Decimal;
  harvestableGross: Decimal;
  taxSaving: Decimal;
} {
  const tfRate = tfRateRaw !== undefined ? D(tfRateRaw) : ZERO;
  const ONE = D(1);
  const exemptFraction = Decimal.min(ONE, Decimal.max(ZERO, tfRate));
  const multiplier = ONE.minus(exemptFraction);

  let adjustedGain: Decimal;
  let harvestableGross: Decimal;

  if (multiplier.isZero()) {
    adjustedGain = ZERO;
    harvestableGross = grossGain;
  } else {
    adjustedGain = grossGain.times(multiplier);
    const maxGross = remaining.div(multiplier);
    harvestableGross = Decimal.min(grossGain, maxGross);
  }

  const adjustedCapped = Decimal.min(adjustedGain, remaining);
  const taxSaving = adjustedCapped.times(taxRate);

  return { adjustedGain, harvestableGross, taxSaving };
}
