import { describe, it, expect } from "vitest";
import {
  ASSET_CLASSES,
  isAssetClass,
  FixtureProvider,
  MarketDataService,
  type InstrumentRef,
  type MarketDataProvider,
} from "../src/index.js";

const bbca: InstrumentRef = {
  symbol: "BBCA",
  market: "IDX",
  assetClass: "equity",
  currency: "IDR",
};

describe("asset classes", () => {
  it("lists and narrows asset classes", () => {
    expect(ASSET_CLASSES).toContain("gold");
    expect(isAssetClass("bond")).toBe(true);
    expect(isAssetClass("nope")).toBe(false);
  });
});

describe("FixtureProvider", () => {
  const provider = new FixtureProvider();

  it("quotes known symbols and returns null for unknown", async () => {
    expect(await provider.getQuote(bbca)).toMatchObject({
      price: "9500",
      currency: "IDR",
    });
    expect(
      await provider.getQuote({ ...bbca, symbol: "UNKNOWN" }),
    ).toBeNull();
  });

  it("supports any asset class / market", () => {
    expect(provider.supports("gold", "XAU")).toBe(true);
  });
});

describe("MarketDataService", () => {
  it("routes to the first supporting provider", async () => {
    const goldOnly: MarketDataProvider = {
      name: "gold",
      supports: (ac) => ac === "gold",
      getQuote: async (ref) => ({
        price: "1200000",
        currency: ref.currency,
        asOf: "2026-02-08T00:00:00.000Z",
      }),
    };
    const svc = new MarketDataService([goldOnly, new FixtureProvider()]);

    // equity → falls through gold-only to the fixture provider
    expect((await svc.getQuote(bbca))?.price).toBe("9500");
    // gold → the gold provider wins
    const gold = await svc.getQuote({
      symbol: "GOLD",
      market: "XAU",
      assetClass: "gold",
      currency: "IDR",
    });
    expect(gold?.price).toBe("1200000");
  });

  it("batch-quotes by id and drops misses", async () => {
    const svc = new MarketDataService([new FixtureProvider()]);
    const quotes = await svc.getQuotes([
      { id: "i1", ref: bbca },
      { id: "i2", ref: { ...bbca, symbol: "MISSING" } },
    ]);
    expect(quotes.i1.price).toBe("9500");
    expect(quotes.i2).toBeUndefined();
  });
});
