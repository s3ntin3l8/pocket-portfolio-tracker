import type { Ledger } from "../ledger.js";

// A EUR user with a EUR depot and a SEK-base depot: each portfolio summary is in its own base
// currency, /networth in the user's display currency (EUR). Uses SEK, which no other ledger
// quotes (fx_rates rows are global).
//
//   eu:  buy 10 @ 100 EUR, quote 110            -> 1100 EUR
//   se:  buy 10 @ 1000 SEK, quote 1200          -> 12000 SEK (summary)
//   SEK→EUR 0.09 on asOf                         -> 12000 × 0.09 = 1080 EUR
//
// /networth = 1100 + 1080 = 2180 EUR.
export const multiBase: Ledger = {
  name: "multi-base",
  asOf: "2026-08-15T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: {
    eu: { name: "EU depot", baseCurrency: "EUR", cashCounted: false },
    se: { name: "SE depot", baseCurrency: "SEK", cashCounted: false },
  },
  instruments: {
    abc: {
      symbol: "ABC",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "ABC AG",
      price: "110",
    },
    sek: {
      symbol: "SEKCO",
      market: "STO",
      assetClass: "equity",
      currency: "SEK",
      name: "Svensk AB",
      price: "1200",
    },
  },
  fx: [{ base: "SEK", quote: "EUR", rate: "0.09", date: "2026-08-15" }],
  transactions: [
    {
      portfolio: "eu",
      type: "buy",
      instrument: "abc",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2026-02-10T10:00:00.000Z",
    },
    {
      portfolio: "se",
      type: "buy",
      instrument: "sek",
      quantity: "10",
      price: "1000",
      currency: "SEK",
      at: "2026-02-10T10:00:00.000Z",
    },
  ],
};

export const multiBaseExpected = { euSummary: "1100", seSummarySek: "12000", networth: "2180" };
