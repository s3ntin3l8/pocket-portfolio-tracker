import type { AssetClass, InstrumentRef, Quote } from "@portfolio/market-data";
import type { MarketDataProvider } from "@portfolio/market-data";
import { getScrapedQuote, navKey } from "../scrapers/store.js";
import { getDb } from "../../db/client.js";

export class ScrapedBuybackProvider implements MarketDataProvider {
  readonly name: string;
  private readonly market: string;
  private readonly key: string;

  constructor(opts: { name: string; market: string; key: string }) {
    this.name = opts.name;
    this.market = opts.market;
    this.key = opts.key;
  }

  supports(assetClass: AssetClass, market: string): boolean {
    return assetClass === "gold" && market === this.market;
  }

  async getQuote(ref: InstrumentRef): Promise<Quote | null> {
    const buyback = await getScrapedQuote(getDb(), this.key);
    if (buyback === null) return null;
    return {
      price: String(buyback),
      currency: ref.currency,
      asOf: new Date().toISOString(),
    };
  }
}

export class ScrapedNavProvider implements MarketDataProvider {
  readonly name = "nav";

  supports(assetClass: AssetClass): boolean {
    return assetClass === "mutual_fund";
  }

  async getQuote(ref: InstrumentRef): Promise<Quote | null> {
    const nav = await getScrapedQuote(getDb(), navKey(ref.symbol));
    if (nav === null) return null;
    return {
      price: String(nav),
      currency: ref.currency,
      asOf: new Date().toISOString(),
    };
  }
}
