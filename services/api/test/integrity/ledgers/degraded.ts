import type { Ledger } from "../ledger.js";

// Two degraded holdings in a EUR depot; neither may be valued as 0 or converted 1:1.
//
//   NOQ    EUR, no quote at all:  buy 5 @ 20 -> valued at cost, 5 × 20 = 100 (flagged valuedAtCost)
//   CADCO  CAD, quote 12, but no CAD→EUR rate: excluded from every total (flagged fxMissing),
//          and "CAD" is disclosed in fxMissingCurrencies — never treated as 1 CAD = 1 EUR.
//
// net worth = 100 (NOQ only).
export const degraded: Ledger = {
  name: "degraded",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    noq: {
      symbol: "NOQ",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "No Quote AG",
    },
    cad: {
      symbol: "CADCO",
      market: "TSX",
      assetClass: "equity",
      currency: "CAD",
      name: "Maple Corp",
      price: "12",
    },
  },
  transactions: [
    {
      portfolio: "depot",
      type: "buy",
      instrument: "noq",
      quantity: "5",
      price: "20",
      currency: "EUR",
      at: "2026-02-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "buy",
      instrument: "cad",
      quantity: "3",
      price: "10",
      currency: "CAD",
      at: "2026-02-10T10:00:00.000Z",
    },
  ],
};

export const degradedExpected = { netWorth: "100", fxMissingCurrencies: ["CAD"] };
