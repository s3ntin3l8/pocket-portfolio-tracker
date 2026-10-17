/**
 * Every region bucket uses one vocabulary: the names `COUNTRY_TO_REGION` returns
 * ("North America", "Europe", "Asia", ...). Markets (listing venue) and cash currencies map
 * straight to those names, so an ETF's country weights, the listing-venue fallback and cash
 * all land in the same slice (#1025). Anything unmapped (and gold, `XAU`) is "Other".
 */
const MARKET_TO_REGION: Record<string, string> = {
  IDX: "Asia",
  BEI: "Asia",
  XETRA: "Europe",
  XFRA: "Europe",
  FSX: "Europe",
  AMS: "Europe",
  NYSE: "North America",
  NASDAQ: "North America",
  US: "North America",
  NASDAQ_GS: "North America",
  NASDAQ_GM: "North America",
  XAU: "Other",
  AMEX: "North America",
  TSX: "North America",
  ASX: "Asia",
  SGX: "Asia",
  HKG: "Asia",
  TYO: "Asia",
};

const CURRENCY_TO_REGION: Record<string, string> = {
  IDR: "Asia",
  EUR: "Europe",
  USD: "North America",
  GBP: "Europe",
  CHF: "Europe",
  NOK: "Europe",
  SEK: "Europe",
  DKK: "Europe",
  CAD: "North America",
  AUD: "Asia",
  SGD: "Asia",
  HKD: "Asia",
  JPY: "Asia",
  CNY: "Asia",
};

const COUNTRY_TO_REGION: Record<string, string> = {
  "United States": "North America",
  Canada: "North America",
  Mexico: "North America",
  Brazil: "Latin America",
  Germany: "Europe",
  France: "Europe",
  "United Kingdom": "Europe",
  Italy: "Europe",
  Spain: "Europe",
  Netherlands: "Europe",
  Switzerland: "Europe",
  Austria: "Europe",
  Belgium: "Europe",
  Denmark: "Europe",
  Finland: "Europe",
  Ireland: "Europe",
  Luxembourg: "Europe",
  Norway: "Europe",
  Poland: "Europe",
  Portugal: "Europe",
  Sweden: "Europe",
  Czechia: "Europe",
  Greece: "Europe",
  Hungary: "Europe",
  Romania: "Europe",
  Turkey: "Europe",
  "South Africa": "Africa & ME",
  "United Arab Emirates": "Africa & ME",
  "Saudi Arabia": "Africa & ME",
  Japan: "Asia",
  China: "Asia",
  India: "Asia",
  "South Korea": "Asia",
  Taiwan: "Asia",
  "Hong Kong": "Asia",
  Singapore: "Asia",
  Australia: "Asia",
  Thailand: "Asia",
  Indonesia: "Asia",
  Malaysia: "Asia",
  Philippines: "Asia",
  Vietnam: "Asia",
};

const SECTOR_ALIAS_MAP: Record<string, string> = {
  "Financial Services": "Financials",
  "Consumer Defensive": "Consumer Staples",
  "Consumer Cyclical": "Consumer Discretionary",
  "Communication Services": "Communication",
  "Basic Materials": "Materials",
  "Real Estate": "Real Estate",
  Utilities: "Utilities",
  Industrials: "Industrials",
  Healthcare: "Health Care",
  "Health Care": "Health Care",
};

/** Every region name a slice key can take: what the maps above emit, plus the "Other" fallback. */
export const REGION_NAMES: readonly string[] = [
  ...new Set([
    ...Object.values(MARKET_TO_REGION),
    ...Object.values(CURRENCY_TO_REGION),
    ...Object.values(COUNTRY_TO_REGION),
    "Other",
  ]),
];

export function marketToRegion(market: string): string {
  return MARKET_TO_REGION[market.toUpperCase()] ?? "Other";
}

export function currencyToRegion(currency: string): string {
  return CURRENCY_TO_REGION[currency.toUpperCase()] ?? "Other";
}

export function countryToRegion(country: string): string {
  return COUNTRY_TO_REGION[country] ?? "Other";
}

export function normalizeSector(name: string): string {
  return SECTOR_ALIAS_MAP[name] ?? name;
}
