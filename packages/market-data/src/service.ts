import type {
  AssetClass,
  InstrumentRef,
  MarketDataProvider,
  Quote,
} from "./types.js";

/**
 * Routes quote/history requests to the first provider that supports the
 * instrument's asset class + market. Live providers are registered ahead of the
 * fixture fallback once their API keys are configured.
 */
export class MarketDataService {
  constructor(private readonly providers: MarketDataProvider[]) {}

  providerFor(assetClass: AssetClass, market: string): MarketDataProvider | null {
    return this.providers.find((p) => p.supports(assetClass, market)) ?? null;
  }

  async getQuote(ref: InstrumentRef): Promise<Quote | null> {
    const provider = this.providerFor(ref.assetClass, ref.market);
    return provider ? provider.getQuote(ref) : null;
  }

  /** Quote several instruments, keyed by an id you supply (e.g. instrument id). */
  async getQuotes(
    refs: Array<{ id: string; ref: InstrumentRef }>,
  ): Promise<Record<string, Quote>> {
    const out: Record<string, Quote> = {};
    await Promise.all(
      refs.map(async ({ id, ref }) => {
        const quote = await this.getQuote(ref);
        if (quote) out[id] = quote;
      }),
    );
    return out;
  }
}
