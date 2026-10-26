import type { Ledger } from "../ledger.js";

// Stored daily snapshots (what the snapshot job writes) feeding the two history endpoints.
// Two EUR depots; B starts a day later than A. Values are supplied directly: the history
// endpoints read the stored rows, they do not recompute from transactions.
//
//   A: 2026-06-26 1,000   2026-06-27 1,010   2026-06-28 1,020
//   B:                    2026-06-27   500   2026-06-28   505
//
// The aggregate at a date is the sum of that date's snapshots (a portfolio counts only on the
// dates it has one, and no FX is involved when everything is already in the display currency):
//   2026-06-26: 1,000
//   2026-06-27: 1,010 + 500 = 1,510
//   2026-06-28: 1,020 + 505 = 1,525
export const history: Ledger = {
  name: "history",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: {
    a: { name: "Depot A", baseCurrency: "EUR", cashCounted: false },
    b: { name: "Depot B", baseCurrency: "EUR", cashCounted: false },
  },
  instruments: {},
  snapshots: [
    { portfolio: "a", date: "2026-06-26", netWorth: "1000", marketValue: "1000" },
    { portfolio: "a", date: "2026-06-27", netWorth: "1010", marketValue: "1010" },
    { portfolio: "a", date: "2026-06-28", netWorth: "1020", marketValue: "1020" },
    { portfolio: "b", date: "2026-06-27", netWorth: "500", marketValue: "500" },
    { portfolio: "b", date: "2026-06-28", netWorth: "505", marketValue: "505" },
  ],
  transactions: [],
};

export const historyExpected = {
  aggregate: [
    { date: "2026-06-26", netWorth: "1000", marketValue: "1000" },
    { date: "2026-06-27", netWorth: "1510", marketValue: "1510" },
    { date: "2026-06-28", netWorth: "1525", marketValue: "1525" },
  ],
  b: [
    { date: "2026-06-27", netWorth: "500", marketValue: "500" },
    { date: "2026-06-28", netWorth: "505", marketValue: "505" },
  ],
};
