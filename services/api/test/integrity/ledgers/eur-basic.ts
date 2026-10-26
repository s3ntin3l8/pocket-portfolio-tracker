import type { Ledger } from "../ledger.js";

// One EUR depot (cash outside the boundary), one instrument.
//
//   2026-01-15  buy  10 @ 100            -> 10 sh, cost 1000
//   2026-02-15  buy   5 @ 120            -> 15 sh, cost 1600, avg 106.666…
//   2026-03-15  sell  6 @ 130            -> proceeds 780, cost of sold 6 × 1600/15 = 640
//   2026-04-15  dividend 30 (lump sum)
//   quote at asOf: 140
export const eurBasic: Ledger = {
  name: "eur-basic",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    abc: {
      symbol: "ABC",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "ABC Corp",
      price: "140",
    },
  },
  transactions: [
    {
      portfolio: "depot",
      type: "buy",
      instrument: "abc",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2026-01-15T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "buy",
      instrument: "abc",
      quantity: "5",
      price: "120",
      currency: "EUR",
      at: "2026-02-15T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "sell",
      instrument: "abc",
      quantity: "6",
      price: "130",
      currency: "EUR",
      at: "2026-03-15T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "dividend",
      instrument: "abc",
      price: "30",
      currency: "EUR",
      at: "2026-04-15T10:00:00.000Z",
    },
  ],
};

// Hand-derived expectations.
export const eurBasicExpected = {
  openShares: "9", // 15 − 6
  costOfOpen: "960", // 9 × 1600/15
  value: "1260", // 9 × 140
  unrealized: "300", // 1260 − 960
  realized: "140", // 780 − 640
  income: "30",
};
