const MARKET_TO_REGION: Record<string, string> = {
  IDX: "ID",
  BEI: "ID",
  XETRA: "EU",
  XFRA: "EU",
  FSX: "EU",
  AMS: "EU",
  NYSE: "US",
  NASDAQ: "US",
  US: "US",
  NASDAQ_GS: "US",
  NASDAQ_GM: "US",
  XAU: "Commodity",
  AMEX: "US",
  TSX: "CA",
  ASX: "AU",
  SGX: "SG",
  HKG: "HK",
  TYO: "JP",
};

const CURRENCY_TO_REGION: Record<string, string> = {
  IDR: "ID",
  EUR: "EU",
  USD: "US",
  GBP: "EU",
  CHF: "EU",
  NOK: "EU",
  SEK: "EU",
  DKK: "EU",
  CAD: "CA",
  AUD: "AU",
  SGD: "SG",
  HKD: "HK",
  JPY: "JP",
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
