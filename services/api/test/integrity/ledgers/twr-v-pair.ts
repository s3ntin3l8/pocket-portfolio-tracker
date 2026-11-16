import type { Ledger } from "../ledger.js";

// A one-day artifact snapshot and its rebound (a V) in the stored daily snapshots, feeding
// `GET /portfolios/:id/history`. The TWR chain must book the pair as neutral (#1263).
// One EUR depot, cash outside; values are supplied directly (the history endpoint reads the
// stored rows). Daily growth g_t = (V_t − flow_t) / V_{t−1}; the guard accepts |g−1| ≤ 0.5.
//
//   06-01  V = 1000, flow 1000   first point: index 100, pct 0
//   06-02  V = 1010, flow 0      g = 1010/1000 = 1.01              → index 101, pct 1
//   06-03  V =  650, flow 5      g = (650 − 5)/1010 = 645/1010     ≈ 0.63861 (−36.1%, passes)
//   06-04  V = 1015, flow 0      g = 1015/650 = 203/130            ≈ 1.56154 (+56.2%, fails the cap)
//   06-05  V = 1025.15, flow 0   g = 1025.15/1015 = 1.01
//
// V-pair check on 06-03/06-04: g3 × g4 = (645/1010) × (1015/650) = 654675/656500 ≈ 0.99722,
// |0.99722 − 1| = 0.0028 ≤ 0.01 → both growths are 1, so
//   index: 100, 101, 101, 101, then 101 × 1.01 = 102.01 → pct 0, 1, 1, 1, 2.01.
// (Before the fix 06-03 was accepted — pct ≈ −35.5 — and 06-04 dropped, leaving the step.)
export const twrVPair: Ledger = {
  name: "twr-v-pair",
  asOf: "2026-06-10T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: {
    depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false },
  },
  instruments: {},
  snapshots: [
    {
      portfolio: "depot",
      date: "2026-06-01",
      netWorth: "1000",
      marketValue: "1000",
      effectiveFlow: "1000",
    },
    { portfolio: "depot", date: "2026-06-02", netWorth: "1010", marketValue: "1010" },
    {
      portfolio: "depot",
      date: "2026-06-03",
      netWorth: "650",
      marketValue: "650",
      effectiveFlow: "5",
    },
    { portfolio: "depot", date: "2026-06-04", netWorth: "1015", marketValue: "1015" },
    { portfolio: "depot", date: "2026-06-05", netWorth: "1025.15", marketValue: "1025.15" },
  ],
  transactions: [],
};

export const twrVPairExpected = {
  pct: [
    { date: "2026-06-01", pct: "0" },
    { date: "2026-06-02", pct: "1" },
    { date: "2026-06-03", pct: "1" },
    { date: "2026-06-04", pct: "1" },
    { date: "2026-06-05", pct: "2.01" },
  ],
};
