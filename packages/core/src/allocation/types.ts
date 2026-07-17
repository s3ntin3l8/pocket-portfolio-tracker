export interface AllocationInstrumentMeta {
  assetClass: string;
  market: string;
  sector?: string | null;
  sectorWeights?: Record<string, number> | null;
  countryWeights?: Record<string, number> | null;
  sectorCheckedAt?: Date | string | null;
  name?: string;
}

export interface AllocationSlice {
  key: string;
  value: string;
  pct: number;
}

export interface TopHolding {
  instrumentId: string;
  name?: string;
  assetClass?: string;
  value: string;
  pct: number;
}

export interface ConcentrationInfo {
  hhi: number;
  top1Pct: number;
  top5Pct: number;
  label: "diversified" | "moderate" | "concentrated";
}

export interface AllocationBreakdown {
  byAssetClass: AllocationSlice[];
  byCurrency: AllocationSlice[];
  byRegion: AllocationSlice[];
  bySector: AllocationSlice[];
  topHoldings: TopHolding[];
  concentration: ConcentrationInfo;
}
