const TROY_OUNCE_GRAMS = 31.1034768;

const FUNDAMENTALS_MODULES =
  "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,earnings,recommendationTrend,fundProfile";

const FUNDAMENTALS_TIMEOUT_MS = 8000;

const YAHOO_ETF_SECTOR_KEY: Record<string, string> = {
  realestate: "Real Estate",
  technology: "Technology",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  financial_services: "Financial Services",
  communication_services: "Communication Services",
  basic_materials: "Basic Materials",
  utilities: "Utilities",
  industrials: "Industrials",
  healthcare: "Healthcare",
  energy: "Energy",
};

export { TROY_OUNCE_GRAMS, FUNDAMENTALS_MODULES, FUNDAMENTALS_TIMEOUT_MS, YAHOO_ETF_SECTOR_KEY };
