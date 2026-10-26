import type { Ledger } from "../ledger.js";

// One savings account (cash INSIDE the boundary) and one invest-only depot (cash OUTSIDE).
// Each portfolio keeps its own same-boundary value/contribution pair; the aggregate sums the
// pairs and reports the boundary as "mixed" (CLAUDE.md "one boundary per portfolio").
//
//   savings:  deposit 1,000 (2026-01-10)                    value 1,000, contributed 1,000
//   depot:    buy 10 @ 100 (2026-02-10), quote 110          value 1,100, cost 1,000,
//                                                           unrealized 100, contributed 1,000
//
// aggregate: value 2,100; costOfOpen 1,000; unrealized 100; netContributed 2,000.
export const mixedBoundary: Ledger = {
  name: "mixed-boundary",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: {
    savings: { name: "Tagesgeld", baseCurrency: "EUR", cashCounted: true },
    depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false },
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
  },
  transactions: [
    {
      portfolio: "savings",
      type: "deposit",
      price: "1000",
      currency: "EUR",
      at: "2026-01-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "buy",
      instrument: "abc",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2026-02-10T10:00:00.000Z",
    },
  ],
};

export const mixedBoundaryExpected = {
  savings: {
    boundary: "inside",
    value: "1000",
    costOfOpen: "0",
    unrealized: "0",
    realized: "0",
    income: "0",
    netContributed: "1000",
  },
  depot: {
    boundary: "outside",
    value: "1100",
    costOfOpen: "1000",
    unrealized: "100",
    realized: "0",
    income: "0",
    netContributed: "1000",
  },
  all: {
    boundary: "mixed",
    value: "2100",
    costOfOpen: "1000",
    unrealized: "100",
    realized: "0",
    income: "0",
    netContributed: "2000",
  },
};
