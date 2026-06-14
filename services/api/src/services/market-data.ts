import { FixtureProvider, MarketDataService } from "@portfolio/market-data";

let service: MarketDataService | null = null;

/**
 * The app's market-data service. Live providers (Sectors/iTick for IDX, GoldAPI +
 * Antam for gold, NAV feeds for funds) are registered here once their API keys are
 * configured; the FixtureProvider is the always-available fallback.
 */
export function getMarketData(): MarketDataService {
  if (!service) {
    service = new MarketDataService([new FixtureProvider()]);
  }
  return service;
}
