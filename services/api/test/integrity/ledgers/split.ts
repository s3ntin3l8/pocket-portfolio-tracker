import type { Ledger } from "../ledger.js";

// A 4:1 split between a buy and a partial sell, cash outside the boundary.
//
//   2026-01-10  buy 10 @ 200                    cost 2000
//   2026-03-01  split 4:1 (ex-date)             40 sh, avg cost 50 (cost unchanged)
//   2026-04-01  sell 8 @ 55                     proceeds 440; cost of sold 8 × 50 = 400
//   quote at asOf: 60 (post-split terms)
//
// open: 32 sh, cost 1600, value 32 × 60 = 1920, unrealized 320, realized 440 − 400 = 40.
// The contribution walk must be split-aware (#823): invested 2000 − cost of sold 400 = 1600.
// A pool that ignores the split would price the 8 sold shares at 200 each (1600) and report
// 2000 − 1600 = 400.
export const split: Ledger = {
  name: "split",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    spl: {
      symbol: "SPL",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "Split AG",
      price: "60",
    },
  },
  corporateActions: [{ instrument: "spl", type: "split", ratio: "4", exDate: "2026-03-01" }],
  transactions: [
    {
      portfolio: "depot",
      type: "buy",
      instrument: "spl",
      quantity: "10",
      price: "200",
      currency: "EUR",
      at: "2026-01-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "sell",
      instrument: "spl",
      quantity: "8",
      price: "55",
      currency: "EUR",
      at: "2026-04-01T10:00:00.000Z",
    },
  ],
};

export const splitExpected = {
  openShares: "32",
  gain: {
    value: "1920",
    costOfOpen: "1600",
    unrealized: "320",
    realized: "40",
    netContributed: "1600",
  },
};
