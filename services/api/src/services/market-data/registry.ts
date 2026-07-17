import {
  BuybackProvider,
  CoinGeckoProvider,
  EodhdProvider,
  GoldApiProvider,
  JustEtfProvider,
  NavProvider,
  TwelveDataProvider,
  YahooFinanceProvider,
} from "@portfolio/market-data";
import { type ProviderSetting } from "@portfolio/db";
import { ANTAM_BUYBACK_KEY, GALERI24_BUYBACK_KEY } from "../scrapers/store.js";
import {
  type ResolvedSecret,
  type ProviderDescriptor,
  type ResolvedProvider,
  type GoldSource,
} from "./types.js";
import { ScrapedBuybackProvider, ScrapedNavProvider } from "./providers.js";

export const PROVIDER_REGISTRY: ProviderDescriptor[] = [
  {
    id: "twelvedata",
    label: "Twelve Data",
    defaultPriority: 1,
    keyEnvVar: "TWELVEDATA_API_KEY",
    configured: (s) => Boolean(s?.apiKey ?? process.env.TWELVEDATA_API_KEY),
    create: (s) => new TwelveDataProvider(s?.apiKey ?? process.env.TWELVEDATA_API_KEY!),
  },
  {
    id: "goldapi",
    label: "GoldAPI",
    defaultPriority: 2,
    keyEnvVar: "GOLDAPI_KEY",
    configured: (s) => Boolean(s?.apiKey ?? process.env.GOLDAPI_KEY),
    create: (s) => new GoldApiProvider(s?.apiKey ?? process.env.GOLDAPI_KEY!),
  },
  {
    id: "antam",
    label: "Antam buyback",
    defaultPriority: 3,
    goldMarket: "ANTAM",
    configured: () => true,
    create: (s) => {
      const baseUrl = s?.url ?? process.env.ANTAM_BUYBACK_URL;
      return baseUrl
        ? new BuybackProvider({ name: "antam", market: "ANTAM", baseUrl })
        : new ScrapedBuybackProvider({
            name: "antam",
            market: "ANTAM",
            key: ANTAM_BUYBACK_KEY,
          });
    },
  },
  {
    id: "galeri24",
    label: "Galeri24 buyback",
    defaultPriority: 4,
    goldMarket: "GALERI24",
    configured: () => true,
    create: (s) => {
      const baseUrl = s?.url ?? process.env.GALERI24_BUYBACK_URL;
      return baseUrl
        ? new BuybackProvider({ name: "galeri24", market: "GALERI24", baseUrl })
        : new ScrapedBuybackProvider({
            name: "galeri24",
            market: "GALERI24",
            key: GALERI24_BUYBACK_KEY,
          });
    },
  },
  {
    id: "nav",
    label: "Reksa Dana NAV",
    defaultPriority: 5,
    configured: () => true,
    create: (s) => {
      const baseUrl = s?.url ?? process.env.NAV_BASE_URL;
      return baseUrl ? new NavProvider({ baseUrl }) : new ScrapedNavProvider();
    },
  },
  {
    id: "eodhd",
    label: "EODHD",
    defaultPriority: 6,
    keyEnvVar: "EODHD_API_KEY",
    configured: (s) => Boolean(s?.apiKey ?? process.env.EODHD_API_KEY),
    create: (s) => new EodhdProvider({ apiKey: s?.apiKey ?? process.env.EODHD_API_KEY! }),
  },
  {
    id: "coingecko",
    label: "CoinGecko",
    defaultPriority: 7,
    keyEnvVar: "COINGECKO_API_KEY",
    configured: () => true,
    create: (s) => new CoinGeckoProvider({ apiKey: s?.apiKey ?? process.env.COINGECKO_API_KEY }),
  },
  {
    id: "yahoo",
    label: "Yahoo Finance",
    defaultPriority: 8,
    configured: () => true,
    create: () => new YahooFinanceProvider(),
  },
  {
    id: "justetf",
    label: "JustETF",
    defaultPriority: 9,
    configured: () => true,
    create: () => new JustEtfProvider(),
  },
];

export function resolveProviderConfig(
  rows: Pick<ProviderSetting, "provider" | "enabled" | "priority">[],
  registry: ProviderDescriptor[] = PROVIDER_REGISTRY,
  credentials?: Map<string, ResolvedSecret>,
): ResolvedProvider[] {
  const byId = new Map(rows.map((r) => [r.provider, r]));
  return registry
    .map((d) => {
      const row = byId.get(d.id);
      const secret = credentials?.get(d.id);
      return {
        id: d.id,
        label: d.label,
        configured: d.configured(secret),
        enabled: row ? row.enabled : true,
        priority: row ? row.priority : d.defaultPriority,
      };
    })
    .sort((a, b) => a.priority - b.priority);
}

export function goldSources(
  rows: Pick<ProviderSetting, "provider" | "enabled" | "priority">[],
  registry: ProviderDescriptor[] = PROVIDER_REGISTRY,
  credentials?: Map<string, ResolvedSecret>,
): GoldSource[] {
  const goldMarketById = new Map(
    registry.filter((d) => d.goldMarket).map((d) => [d.id, d.goldMarket!]),
  );
  return resolveProviderConfig(rows, registry, credentials)
    .filter((p) => p.configured && p.enabled && goldMarketById.has(p.id))
    .map((p) => ({ market: goldMarketById.get(p.id)!, label: p.label }));
}
