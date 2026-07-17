import { Decimal } from "decimal.js";
import type { PortfolioSummary } from "../valuation.js";
import type {
  AllocationInstrumentMeta,
  TopHolding,
  ConcentrationInfo,
  AllocationBreakdown,
} from "./types.js";
import { marketToRegion, currencyToRegion, countryToRegion, normalizeSector } from "./maps.js";
import { add, sortedSlices } from "./helpers.js";

export function allocationBreakdown(
  summary: PortfolioSummary,
  instruments: Map<string, AllocationInstrumentMeta> | Record<string, AllocationInstrumentMeta>,
): AllocationBreakdown {
  const meta = (id: string): AllocationInstrumentMeta | undefined =>
    instruments instanceof Map ? instruments.get(id) : instruments[id];

  const total = Object.values(summary.exposureByCurrency).reduce(
    (acc, v) => acc.add(v),
    new Decimal(0),
  );

  const byAssetClass = new Map<string, Decimal>();
  const byRegion = new Map<string, Decimal>();
  const bySector = new Map<string, Decimal>();
  const holdingsByCcy = new Map<string, Decimal>();

  let holdingsTotal = new Decimal(0);

  const pricedHoldings: Array<{
    instrumentId: string;
    name: string | undefined;
    assetClass: string | undefined;
    mv: Decimal;
  }> = [];

  for (const h of summary.holdings) {
    if (h.marketValueDisplay == null) continue;
    const mv = new Decimal(h.marketValueDisplay);
    const m = meta(h.instrumentId);

    add(byAssetClass, m?.assetClass ?? "unknown", mv);

    if (m?.countryWeights && Object.keys(m.countryWeights).length > 0) {
      let sumW = 0;
      for (const [country, w] of Object.entries(m.countryWeights)) {
        if (w > 0) {
          add(byRegion, countryToRegion(country), mv.mul(w));
          sumW += w;
        }
      }
      if (sumW < 0.9999) {
        add(byRegion, marketToRegion(m?.market ?? ""), mv.mul(1 - sumW));
      }
    } else {
      add(byRegion, marketToRegion(m?.market ?? ""), mv);
    }

    if (m?.sectorWeights && Object.keys(m.sectorWeights).length > 0) {
      let sumW = 0;
      for (const [sector, w] of Object.entries(m.sectorWeights)) {
        if (w > 0) {
          add(bySector, normalizeSector(sector), mv.mul(w));
          sumW += w;
        }
      }
      if (sumW < 0.9999) {
        add(bySector, "Other", mv.mul(1 - sumW));
      }
    } else if (m?.sector) {
      add(bySector, normalizeSector(m.sector), mv);
    } else {
      add(bySector, "uncategorized", mv);
    }

    if (h.currency != null) {
      add(holdingsByCcy, h.currency, mv);
    }

    holdingsTotal = holdingsTotal.add(mv);
    pricedHoldings.push({
      instrumentId: h.instrumentId,
      name: m?.name,
      assetClass: m?.assetClass,
      mv,
    });
  }

  let cashTotal = new Decimal(0);
  for (const [ccy, exposureDisplay] of Object.entries(summary.exposureByCurrency)) {
    const holdingsInCcy = holdingsByCcy.get(ccy) ?? new Decimal(0);
    const cashInCcy = new Decimal(exposureDisplay).sub(holdingsInCcy);
    if (cashInCcy.gt(0)) {
      add(byRegion, currencyToRegion(ccy), cashInCcy);
      cashTotal = cashTotal.add(cashInCcy);
    }
  }
  if (cashTotal.gt(0)) {
    add(byAssetClass, "cash", cashTotal);
  }

  const byCurrencyMap = new Map<string, Decimal>(
    Object.entries(summary.exposureByCurrency)
      .filter(([, v]) => new Decimal(v).gt(0))
      .map(([k, v]) => [k, new Decimal(v)]),
  );

  const topHoldings: TopHolding[] = pricedHoldings
    .sort((a, b) => b.mv.comparedTo(a.mv))
    .slice(0, 20)
    .map((h) => ({
      instrumentId: h.instrumentId,
      name: h.name,
      assetClass: h.assetClass,
      value: h.mv.toString(),
      pct: (() => {
        if (total.isZero()) return 0;
        return h.mv.div(total).mul(100).toDecimalPlaces(4).toNumber();
      })(),
    }));

  return {
    byAssetClass: sortedSlices(byAssetClass, total),
    byCurrency: sortedSlices(byCurrencyMap, total),
    byRegion: sortedSlices(byRegion, total),
    bySector: sortedSlices(bySector, total),
    topHoldings,
    concentration: concentration(topHoldings),
  };
}

export function concentration(holdings: TopHolding[]): ConcentrationInfo {
  const hhi = Math.round(holdings.reduce((acc, h) => acc + h.pct * h.pct, 0));
  const top1Pct = holdings[0]?.pct ?? 0;
  const top5Pct = holdings.slice(0, 5).reduce((a, h) => a + h.pct, 0);

  let label: ConcentrationInfo["label"];
  if (hhi < 1500) label = "diversified";
  else if (hhi < 2500) label = "moderate";
  else label = "concentrated";

  return { hhi, top1Pct, top5Pct, label };
}
