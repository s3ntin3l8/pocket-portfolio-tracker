import type { Ledger } from "../ledger.js";

// A savings account (cash inside the boundary).
//
//   2026-01-10  deposit    1000
//   2026-03-10  deposit     500
//   2026-04-01  interest     12   (lump sum; return, never contribution)
//   2026-05-10  withdrawal  200
//
// cash = 1000 + 500 + 12 − 200 = 1312; net contributed = 1500 − 200 = 1300.
export const cashInside: Ledger = {
  name: "cash-inside",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { savings: { name: "Tagesgeld", baseCurrency: "EUR", cashCounted: true } },
  instruments: {},
  transactions: [
    {
      portfolio: "savings",
      type: "deposit",
      price: "1000",
      currency: "EUR",
      at: "2026-01-10T10:00:00.000Z",
    },
    {
      portfolio: "savings",
      type: "deposit",
      price: "500",
      currency: "EUR",
      at: "2026-03-10T10:00:00.000Z",
    },
    {
      portfolio: "savings",
      type: "interest",
      price: "12",
      currency: "EUR",
      at: "2026-04-01T10:00:00.000Z",
    },
    {
      portfolio: "savings",
      type: "withdrawal",
      price: "200",
      currency: "EUR",
      at: "2026-05-10T10:00:00.000Z",
    },
  ],
};

export const cashInsideExpected = {
  value: "1312",
  netContributed: "1300",
  income: "12",
  unrealized: "0",
  realized: "0",
};
