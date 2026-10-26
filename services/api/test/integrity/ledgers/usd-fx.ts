import type { Ledger } from "../ledger.js";

// A USD stock held in a EUR depot; the price is flat while USD/EUR moves.
//
//   2026-01-10  buy 10 @ 100 USD     (USD→EUR 0.80 that day)
//   asOf        quote 100 USD        (USD→EUR 0.90)
//
// Value = 10 × 100 USD × 0.90 = 900 EUR, converted at today's rate (the valuation's date).
// Cost is converted at the same rate, so a flat price shows no unrealized gain: 900 − 900 = 0.
// The contribution walk converts at today's rate too (not the 0.80 flow-date rate), so with the
// depot's cash outside the boundary, net contributed = 1000 USD × 0.90 = 900.
export const usdFx: Ledger = {
  name: "usd-fx",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    usd: {
      symbol: "USDCO",
      market: "NASDAQ",
      assetClass: "equity",
      currency: "USD",
      name: "Dollar Corp",
      price: "100",
    },
  },
  fx: [
    { base: "USD", quote: "EUR", rate: "0.8", date: "2026-01-10" },
    { base: "USD", quote: "EUR", rate: "0.9", date: "2026-06-30" },
  ],
  transactions: [
    {
      portfolio: "depot",
      type: "buy",
      instrument: "usd",
      quantity: "10",
      price: "100",
      currency: "USD",
      at: "2026-01-10T10:00:00.000Z",
    },
  ],
};

export const usdFxExpected = {
  value: "900",
  costOfOpen: "900",
  unrealized: "0",
  netContributed: "900",
};
