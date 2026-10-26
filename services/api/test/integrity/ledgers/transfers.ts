import type { Ledger } from "../ledger.js";

// Two invest-only depots (cash outside the boundary) and a Depotübertrag between them.
// The broker feed books the out leg at price 0; the carried cost is the running average.
//
//   A: 2026-01-10  buy 10 @ 40                  cost 400
//   A: 2026-03-01  transfer_out 4 (price 0)     leaves at avg cost 4 × 40 = 160
//   B: 2026-03-01  transfer_in 4 @ 40           arrives at carried cost 160
//   quote at asOf: 50
//
// A: 6 sh, cost 240, value 300. B: 4 sh, cost 160, value 200. Nothing was sold: realized 0.
export const transfers: Ledger = {
  name: "transfers",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: {
    a: { name: "Depot A", baseCurrency: "EUR", cashCounted: false },
    b: { name: "Depot B", baseCurrency: "EUR", cashCounted: false },
  },
  instruments: {
    xyz: {
      symbol: "XYZ",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "XYZ AG",
      price: "50",
    },
  },
  transactions: [
    {
      portfolio: "a",
      type: "buy",
      instrument: "xyz",
      quantity: "10",
      price: "40",
      currency: "EUR",
      at: "2026-01-10T10:00:00.000Z",
    },
    {
      portfolio: "a",
      type: "transfer_out",
      instrument: "xyz",
      quantity: "4",
      price: "0",
      currency: "EUR",
      at: "2026-03-01T10:00:00.000Z",
    },
    {
      portfolio: "b",
      type: "transfer_in",
      instrument: "xyz",
      quantity: "4",
      price: "40",
      currency: "EUR",
      at: "2026-03-01T10:00:00.000Z",
    },
  ],
};

export const transfersExpected = {
  a: { value: "300", costOfOpen: "240", unrealized: "60", realized: "0", netContributed: "240" }, // 400 − 160
  b: { value: "200", costOfOpen: "160", unrealized: "40", realized: "0", netContributed: "160" },
  all: { value: "500", costOfOpen: "400", unrealized: "100", realized: "0", netContributed: "400" },
};
