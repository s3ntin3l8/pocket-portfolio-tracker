import type { Ledger } from "../ledger.js";

// Two depots that each raise one real anomaly, so the aggregate-vs-portfolio anomaly rule runs
// against a real route instead of only a fixture.
//
//   a:  2026-02-01 buy 5 @ 10;  2026-03-01 sell 8 @ 12   -> 8 > 5 held: `oversell`
//   b:  2026-02-01 buy 4 @ 0                               -> a trade at price 0: `zero_price`
export const anomalies: Ledger = {
  name: "anomalies",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: {
    a: { name: "Depot A", baseCurrency: "EUR", cashCounted: false },
    b: { name: "Depot B", baseCurrency: "EUR", cashCounted: false },
  },
  instruments: {
    abc: {
      symbol: "ABC",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "ABC AG",
      price: "10",
    },
  },
  transactions: [
    {
      portfolio: "a",
      type: "buy",
      instrument: "abc",
      quantity: "5",
      price: "10",
      currency: "EUR",
      at: "2026-02-01T10:00:00.000Z",
    },
    {
      portfolio: "a",
      type: "sell",
      instrument: "abc",
      quantity: "8",
      price: "12",
      currency: "EUR",
      at: "2026-03-01T10:00:00.000Z",
    },
    {
      portfolio: "b",
      type: "buy",
      instrument: "abc",
      quantity: "4",
      price: "0",
      currency: "EUR",
      at: "2026-02-01T10:00:00.000Z",
    },
  ],
};

export const anomaliesExpected = { a: ["oversell"], b: ["zero_price"] };
