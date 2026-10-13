import type {
  AssetClass,
  InstrumentRef,
  InstrumentSearchResult,
  MarketDataProvider,
  Quote,
} from "./types.js";
import { isIsin } from "./types.js";

/**
 * Deterministic provider backed by a static price map. Stands in for the live
 * providers (Sectors/iTick, GoldAPI, Antam, NAV feeds) until API keys are wired —
 * same interface, so it swaps out behind the MarketDataService.
 */
export class FixtureProvider implements MarketDataProvider {
  readonly name = "fixture";

  constructor(
    private readonly prices: Record<string, string> = DEFAULT_PRICES,
    /**
     * Fixed quote timestamp. Omitted (the default, and how the production fallback
     * registers it) → each quote is stamped with the time it is served: a stand-in price
     * has no real observation time, and a hard-coded past date made it look like a
     * genuinely stale market quote, which the API's stale-quote gate
     * (`MAX_PRICE_CARRY_FORWARD_DAYS`, audit B13) would rightly discard.
     */
    private readonly asOf?: string,
    private readonly prevCloses: Record<string, string> = DEFAULT_PREV_CLOSES,
    private readonly catalogue: InstrumentSearchResult[] = DEFAULT_CATALOGUE,
  ) {}

  supports(_assetClass: AssetClass, _market: string): boolean {
    return true;
  }

  async getQuote(ref: InstrumentRef): Promise<Quote | null> {
    const price = this.prices[ref.symbol];
    if (price === undefined) return null;
    return {
      price,
      currency: ref.currency,
      asOf: this.asOf ?? new Date().toISOString(),
      previousClose: this.prevCloses[ref.symbol] ?? null,
    };
  }

  /** Deterministic discovery: substring match on the fixture catalogue. */
  async search(query: string): Promise<InstrumentSearchResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.catalogue.filter(
      (i) =>
        i.symbol.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.isin?.toLowerCase() === q,
    );
  }

  async resolveISIN(
    isin: string,
  ): Promise<{ symbol: string; exchange: string; name?: string; type?: string } | null> {
    if (!isIsin(isin)) return null;
    const match = this.catalogue.find((i) => i.isin?.toUpperCase() === isin.trim().toUpperCase());
    if (!match) return null;
    return {
      symbol: match.symbol,
      exchange: match.market,
      name: match.name,
      type: match.assetClass,
    };
  }
}

const DEFAULT_PRICES: Record<string, string> = {};

// Prior-session closes for the deterministic symbols, so day-change is testable.
const DEFAULT_PREV_CLOSES: Record<string, string> = {};

// Discoverable reference data for the manual-entry picker (deterministic, no network).
const DEFAULT_CATALOGUE: InstrumentSearchResult[] = [
  {
    symbol: "BBCA",
    name: "Bank Central Asia Tbk",
    market: "IDX",
    assetClass: "equity",
    currency: "IDR",
    isin: "ID1000109507",
    source: "fixture",
  },
  {
    symbol: "TLKM",
    name: "Telkom Indonesia (Persero) Tbk",
    market: "IDX",
    assetClass: "equity",
    currency: "IDR",
    isin: "ID1000129000",
    source: "fixture",
  },
  {
    symbol: "ORI023",
    name: "Obligasi Negara Ritel seri ORI023",
    market: "IDX",
    assetClass: "bond",
    currency: "IDR",
    source: "fixture",
  },
  {
    symbol: "O",
    name: "Realty Income Corporation",
    market: "US",
    assetClass: "equity",
    currency: "USD",
    isin: "US7561091049",
    source: "fixture",
  },
];
