import type { Ledger } from "../ledger.js";

// A taxable fund merger booked as the paired sell + buy, both `kind: "merger"` (what
// `POST /portfolios/:id/mergers` writes). The old fund is sold at market value and the new one
// bought at the same value, so the basis is stepped up. Cash outside the boundary.
//
//   FUNDA  buy 10 @ 100 (2025-01-10)                       cost 1,000
//   merger 2025-06-01:  sell 10 FUNDA @ 150  (market value 1,500)
//                       buy  20 FUNDB @ 75   (basis 1,500)
//   quote FUNDB at asOf: 90
//
// realized (the sale leg): 1,500 − 1,000 = 500.
// open: 20 FUNDB, cost 1,500, value 20 × 90 = 1,800, unrealized 300.
// The two legs net to zero cash and nothing crosses the boundary, so the merger is
// contribution-neutral: net contributed stays at the 1,000 actually invested (it must not
// become 1,500 from the stepped-up basis).
export const merger: Ledger = {
  name: "merger",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    a: { symbol: "FUNDA", market: "XETRA", assetClass: "etf", currency: "EUR", name: "Fund A" },
    b: {
      symbol: "FUNDB",
      market: "XETRA",
      assetClass: "etf",
      currency: "EUR",
      name: "Fund B",
      price: "90",
    },
  },
  transactions: [
    {
      portfolio: "depot",
      type: "buy",
      instrument: "a",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2025-01-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "sell",
      instrument: "a",
      quantity: "10",
      price: "150",
      kind: "merger",
      currency: "EUR",
      at: "2025-06-01T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "buy",
      instrument: "b",
      quantity: "20",
      price: "75",
      kind: "merger",
      currency: "EUR",
      at: "2025-06-01T10:00:00.000Z",
    },
  ],
};

export const mergerExpected = {
  value: "1800",
  costOfOpen: "1500",
  unrealized: "300",
  realized: "500",
  income: "0",
  netContributed: "1000",
};
