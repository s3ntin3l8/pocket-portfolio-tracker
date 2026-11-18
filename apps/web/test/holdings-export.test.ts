import { describe, expect, it } from "vitest";
import type { HoldingValuation } from "@portfolio/api-client";
import {
  HOLDINGS_EXPORT_HEADERS,
  cashExportRow,
  holdingExportRow,
} from "../src/lib/holdings-export";

const holding = {
  quantity: "13.6",
  avgCost: "146.73",
  costCurrency: "EUR",
  price: "152.93",
  currency: "USD",
  marketValueDisplay: "1895.44",
  unrealizedPnLDisplay: "-104.56",
  instrument: { symbol: "NVDA", name: "NVIDIA", assetClass: "equity", unit: "shares" },
} as unknown as HoldingValuation;

describe("holdings export", () => {
  it("every row is as wide as the header", () => {
    expect(holdingExportRow(holding, "EUR")).toHaveLength(HOLDINGS_EXPORT_HEADERS.length);
    expect(cashExportRow("Cash", "EUR", "10", "10", "EUR")).toHaveLength(
      HOLDINGS_EXPORT_HEADERS.length,
    );
  });

  it("labels avg cost with the cost currency and the price with the quote currency", () => {
    const row = holdingExportRow(holding, "EUR");
    const col = (name: (typeof HOLDINGS_EXPORT_HEADERS)[number]) =>
      row[HOLDINGS_EXPORT_HEADERS.indexOf(name)];
    expect(col("AvgCostCurrency")).toBe("EUR");
    expect(col("PriceCurrency")).toBe("USD");
  });

  it("puts the cash currency under PriceCurrency", () => {
    const row = cashExportRow("Cash", "USD", "10", undefined, "EUR");
    expect(row[HOLDINGS_EXPORT_HEADERS.indexOf("PriceCurrency")]).toBe("USD");
    expect(row[HOLDINGS_EXPORT_HEADERS.indexOf("MarketValue")]).toBe("");
  });
});
