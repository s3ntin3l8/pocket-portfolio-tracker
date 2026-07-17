import { HTML_ENTITIES } from "./constants.js";

export function toNum(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function assetClassOf(raw: string): "equity" | "crypto" | undefined {
  switch (raw.trim().toUpperCase()) {
    case "STOCK":
    case "FUND":
      return "equity"; // refined to etf/mutual_fund at confirm via OpenFIGI
    case "CRYPTO":
      return "crypto";
    default:
      return undefined;
  }
}

export function decodeName(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => HTML_ENTITIES[m] ?? m).trim();
}
