import type { AssetClass } from "@portfolio/schema";

export const ASSET_CLASS: Record<string, AssetClass> = {
  STK: "equity",
  ETF: "etf",
  BOND: "bond",
  BILL: "bond",
  FUND: "mutual_fund",
  CRYPTO: "crypto",
  OPT: "derivative",
  FUT: "derivative",
  FOP: "derivative",
  WAR: "derivative",
};

export function assetClass(raw: string | undefined): AssetClass {
  return ASSET_CLASS[(raw ?? "").toUpperCase()] ?? "equity";
}

export function strNum(v: string | undefined | null): string {
  if (!v) return "0";
  return v.replace(/,/g, "").trim() || "0";
}

export function absStr(v: string | undefined | null): string {
  const n = strNum(v);
  return n.startsWith("-") ? n.slice(1) : n;
}

export const CA_SPLIT_TYPES = new Set(["SO", "FS", "RS"]);
