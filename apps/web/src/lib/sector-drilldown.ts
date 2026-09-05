import type { HoldingValuation } from "@portfolio/api-client";
import { marketToRegion, normalizeSector, countryToRegion } from "@portfolio/core";

export type DrillDownDimension =
  "sector" | "region" | "country" | "currency" | "asset_class" | "industry";

export interface DrillDownInstrument {
  key: string;
  name: string;
  value: number;
}

/**
 * Compute per-instrument breakdown for a given dimension + selected key.
 *
 * - **sector**: ETF decomposed by `sectorWeights[key] × mv`; equity filtered by `sector === key`
 * - **region**: ETF with countryWeights decomposed by country → region mapping;
 *              others use `marketToRegion(instrument.market) === key` → `mv`
 * - **currency**: `instrument.currency === key` → `mv`
 * - **asset_class**: `instrument.assetClass === key` → `mv`
 *
 * Cash holdings (null instrument) are always excluded.
 */
export function getDrillDownInstruments(
  holdings: HoldingValuation[],
  dimension: DrillDownDimension,
  selectedKey: string,
): DrillDownInstrument[] {
  const result: DrillDownInstrument[] = [];

  for (const h of holdings) {
    if (!h.instrument || !h.marketValueDisplay) continue;
    const mv = Number(h.marketValueDisplay);
    if (!Number.isFinite(mv) || mv <= 0) continue;

    let contribution = 0;

    switch (dimension) {
      case "sector":
        if (h.instrument.assetClass === "etf" && h.instrument.sectorWeights) {
          for (const [rawKey, w] of Object.entries(h.instrument.sectorWeights)) {
            if (normalizeSector(rawKey) === selectedKey && typeof w === "number" && w > 0) {
              contribution = mv * w;
            }
          }
        } else if (normalizeSector(h.instrument.sector ?? "") === selectedKey) {
          contribution = mv;
        }
        break;
      case "region":
        // Check if ETF has countryWeights for detailed breakdown
        if (h.instrument.assetClass === "etf" && h.instrument.countryWeights) {
          let regionTotal = 0;
          let sumW = 0;
          for (const [country, w] of Object.entries(h.instrument.countryWeights)) {
            if (typeof w === "number" && w > 0) {
              sumW += w;
              if (countryToRegion(country) === selectedKey) {
                regionTotal += w;
              }
            }
          }
          // Remainder (unclassified countries) goes to listing venue region
          if (sumW < 0.9999 && marketToRegion(h.instrument.market) === selectedKey) {
            regionTotal += 1 - sumW;
          }
          if (regionTotal > 0) {
            contribution = mv * regionTotal;
          }
        } else if (marketToRegion(h.instrument.market) === selectedKey) {
          // Fallback: use listing venue
          contribution = mv;
        }
        break;
      case "currency":
        if (h.currency === selectedKey) {
          contribution = mv;
        }
        break;
      case "asset_class":
        if (h.instrument.assetClass === selectedKey) {
          contribution = mv;
        }
        break;
      case "country":
        if (h.instrument.assetClass === "etf" && h.instrument.countryWeights) {
          for (const [country, w] of Object.entries(h.instrument.countryWeights)) {
            if (country === selectedKey && typeof w === "number" && w > 0) {
              contribution = mv * w;
            }
          }
        } else if (h.instrument.country === selectedKey) {
          contribution = mv;
        }
        break;
      case "industry":
        if (h.instrument.industry === selectedKey) {
          contribution = mv;
        }
        break;
    }

    if (contribution > 0) {
      result.push({ key: h.instrumentId, name: h.instrument.symbol, value: contribution });
    }
  }

  return result.sort((a, b) => b.value - a.value);
}
