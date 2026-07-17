import type { MarketDataProvider } from "@portfolio/market-data";
import type { ProviderUsage } from "@portfolio/market-data";

export interface ResolvedSecret {
  apiKey?: string;
  url?: string;
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  defaultPriority: number;
  configured: (secrets?: ResolvedSecret) => boolean;
  create: (secrets?: ResolvedSecret) => MarketDataProvider;
  goldMarket?: string;
  keyEnvVar?: string;
}

export interface ResolvedProvider {
  id: string;
  label: string;
  configured: boolean;
  enabled: boolean;
  priority: number;
}

export interface GoldSource {
  market: string;
  label: string;
}

export interface ProviderUsageView extends ProviderUsage {
  source: "provider" | "local";
}
