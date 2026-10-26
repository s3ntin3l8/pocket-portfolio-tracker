import type { Ledger } from "../ledger.js";

// A base scenario with exact (terminating) average costs, for relations that move shares or
// split them: nothing here is rounded, so any difference a relation finds is a real one.
//
//   2026-01-10  buy 10 @ 100          cost 1000
//   2026-02-10  buy 10 @ 120          cost 2200 for 20 sh, avg 110
//   2026-03-10  sell 5 @ 130          proceeds 650, cost of sold 5 × 110 = 550, realized 100
//   2026-04-10  dividend 20 (lump)
//   quote at asOf: 140
//
// open 15 sh, cost 1650, value 2100, unrealized 450; outside boundary: contributed 2200 − 550 = 1650.
// The figures are pinned by the golden suite (`metaBaseExpected`), not just documented here.
export const metaBase: Ledger = {
  name: "meta-base",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { a: { name: "Depot A", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    abc: {
      symbol: "ABC",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "ABC AG",
      price: "140",
    },
  },
  transactions: [
    {
      portfolio: "a",
      type: "buy",
      instrument: "abc",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2026-01-10T10:00:00.000Z",
    },
    {
      portfolio: "a",
      type: "buy",
      instrument: "abc",
      quantity: "10",
      price: "120",
      currency: "EUR",
      at: "2026-02-10T10:00:00.000Z",
    },
    {
      portfolio: "a",
      type: "sell",
      instrument: "abc",
      quantity: "5",
      price: "130",
      currency: "EUR",
      at: "2026-03-10T10:00:00.000Z",
    },
    {
      portfolio: "a",
      type: "dividend",
      instrument: "abc",
      price: "20",
      currency: "EUR",
      at: "2026-04-10T10:00:00.000Z",
    },
  ],
};

export const metaBaseExpected = {
  value: "2100", // 15 × 140
  costOfOpen: "1650", // 15 × 110
  unrealized: "450",
  realized: "100", // 5 × (130 − 110)
  income: "20",
  netContributed: "1650", // 2200 − 550
};
