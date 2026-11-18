import type { HoldingValuation } from "@portfolio/api-client";

/** Column order of the holdings CSV; every row builder below emits exactly this many fields. */
export const HOLDINGS_EXPORT_HEADERS = [
  "Symbol",
  "Name",
  "AssetClass",
  "Quantity",
  "Unit",
  "AvgCost",
  "AvgCostCurrency",
  "Price",
  "PriceCurrency",
  "MarketValue",
  "UnrealizedPnL",
  "Currency",
] as const;

/**
 * Per-unit AvgCost is in the cost currency (AvgCostCurrency), Price in the quote currency
 * (PriceCurrency); position value/P&L are in the display currency (the trailing Currency).
 */
export function holdingExportRow(h: HoldingValuation, currency: string): (string | number)[] {
  return [
    h.instrument?.symbol ?? "",
    h.instrument?.name ?? "",
    h.instrument?.assetClass ?? "",
    Number(h.quantity),
    h.instrument?.unit ?? "",
    h.avgCost,
    h.costCurrency ?? h.currency ?? currency,
    h.price ?? "",
    h.currency ?? currency,
    h.marketValueDisplay ?? "",
    h.unrealizedPnLDisplay ?? "",
    currency,
  ];
}

/**
 * Cash row: Quantity is the native balance (an amount, not a share count), PriceCurrency names
 * its currency, MarketValue/Currency are in the display currency (empty without an FX rate, as
 * for an fxMissing holding — the native amount there would carry the wrong currency).
 */
export function cashExportRow(
  label: string,
  ccy: string,
  balance: string,
  displayValue: string | undefined,
  currency: string,
): (string | number)[] {
  return ["Cash", label, "cash", balance, "", "", "", "", ccy, displayValue ?? "", "", currency];
}
