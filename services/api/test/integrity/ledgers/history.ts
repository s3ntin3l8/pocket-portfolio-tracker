import type { Ledger } from "../ledger.js";

// Stored daily snapshots (what the snapshot job writes) feeding the two history endpoints. Two
// EUR depots with the two gap shapes: B starts late, and A has a hole in the middle (as when a
// portfolio is skipped for a missing FX rate). Values are supplied directly: the history
// endpoints read the stored rows, they do not recompute from transactions.
//
//   A: 2026-06-26 1,000   (2026-06-27 missing)   2026-06-28 1,020
//   B:                    2026-06-27   500        2026-06-28   505
//
// The aggregate netWorth at a date is the plain sum of that date's snapshots, a portfolio
// counting only on the dates it has one (no FX is involved: everything is in the display currency):
//   2026-06-26: 1,000                  (only A has a row)
//   2026-06-27:   500                  (only B has a row; A's hole is NOT filled in netWorth)
//   2026-06-28: 1,020 + 505 = 1,525
// The aggregate marketValue deliberately carries A's last value forward over the hole (by
// design, pinned by packages/core's twr tests), so it is not asserted here.
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
    { portfolio: "a", date: "2026-06-28", netWorth: "1020", marketValue: "1020" },
    { portfolio: "b", date: "2026-06-27", netWorth: "500", marketValue: "500" },
    { portfolio: "b", date: "2026-06-28", netWorth: "505", marketValue: "505" },
  ],
  transactions: [],
};

export const historyExpected = {
  aggregateNetWorth: [
    { date: "2026-06-26", netWorth: "1000" },
    { date: "2026-06-27", netWorth: "500" },
    { date: "2026-06-28", netWorth: "1525" },
  ],
  b: [
    { date: "2026-06-27", netWorth: "500", marketValue: "500" },
    { date: "2026-06-28", netWorth: "505", marketValue: "505" },
  ],
};
