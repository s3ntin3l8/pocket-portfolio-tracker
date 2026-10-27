import type { Ledger } from "../ledger.js";

// Every kind of income the one definition (`incomeFlow`) counts, in one EUR depot (2026):
//
//   buy 10 STOCK @ 100                                   (so the dividend is on a held position)
//   2026-03-15 dividend 30, fee 2        -> 30 − 2 = 28  (instrument income, net of the fee)
//   2026-04-01 interest 12               -> 12           (account interest: no instrument)
//   2026-05-01 bonus_cash 5              ->  5           (broker bonus: no instrument)
//   2026-06-01 tax 4 (a standalone debit, e.g. the Vorabpauschale)
//                                         -> −4          (reduces income; not a payment)
//
// Total income = 28 + 12 + 5 − 4 = 41 — on the summary (`totalIncome`, `gain.income`) AND on the
// Income page (`lifetimeTotal`), which used to count only the dividend (#1167).
//   by year 2026: 41 over 3 payments (the tax debit is not a payment)
//   by month:     03: 28   04: 12   05: 5   06: −4
//   by class:     equity 28 (the dividend), cash 13 (12 + 5 − 4); 28 + 13 = 41
//   by instrument: STOCK 28 = 100% of what the securities paid (the bars are about securities)
export const income: Ledger = {
  name: "income",
  asOf: "2026-06-30T12:00:00.000Z",
  displayCurrency: "EUR",
  portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
  instruments: {
    stock: {
      symbol: "STOCK",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "Stock AG",
      price: "100",
    },
  },
  transactions: [
    {
      portfolio: "depot",
      type: "buy",
      instrument: "stock",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2026-01-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "dividend",
      instrument: "stock",
      price: "30",
      fees: "2",
      currency: "EUR",
      at: "2026-03-15T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "interest",
      price: "12",
      currency: "EUR",
      at: "2026-04-01T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "bonus_cash",
      price: "5",
      currency: "EUR",
      at: "2026-05-01T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "tax",
      price: "4",
      currency: "EUR",
      at: "2026-06-01T10:00:00.000Z",
    },
  ],
};

export const incomeExpected = {
  total: "41",
  byYear: [{ year: "2026", total: "41", paymentCount: 3 }],
  monthly: [
    { month: "2026-03", total: "28" },
    { month: "2026-04", total: "12" },
    { month: "2026-05", total: "5" },
    { month: "2026-06", total: "-4" },
  ],
  byClass: { equity: "28", cash: "13" },
  byInstrumentTotals: ["28"],
  paymentCount: 3,
};
