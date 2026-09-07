/**
 * Friendly names for common Yahoo Finance benchmark tickers. The Settings → Investing
 * free-text field accepts any Yahoo-compatible symbol (indices, ETFs); the
 * known-tickers list below just gives the most common ones a presentable label.
 * Unrecognized tickers fall back to the raw ticker — this never blocks a custom
 * benchmark from working.
 *
 * Shared between the API (server-side validation/normalisation of
 * `benchmarkSymbols`) and the web (the picker UI shows the same labels). Kept in
 * `@portfolio/schema` so the two sides can never drift.
 */
export const BENCHMARK_LABELS: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones",
  "^IXIC": "Nasdaq Composite",
  "^RUT": "Russell 2000",
  "^STOXX50E": "Euro Stoxx 50",
  "^GDAXI": "DAX",
  "^N225": "Nikkei 225",
  "^JKSE": "IDX Composite",
  // MSCI World wrappers — Yahoo supports both.
  URTH: "MSCI World (URTH)",
  "IWDA.AS": "MSCI World (IWDA)",
};

/** A human-readable name for a benchmark ticker, falling back to the ticker itself. */
export function benchmarkLabel(symbol: string): string {
  return BENCHMARK_LABELS[symbol] ?? symbol;
}
