import type { Ledger } from "../ledger.js";

// German tax, tax year 2025: a holder with a EUR 1,000 Sparerpauschbetrag (allocated in full to
// the one depot), the default 26.375% rate (25% Abgeltungsteuer + 5.5% Soli on it).
//
//   STOCK (equity, no Teilfreistellung)  buy 10 @ 100 (2025-01-10), sell 10 @ 160 (2025-05-10)
//        realized 10 × (160 − 100) = 600                              -> stock pot  +600
//   FUND  (ETF, default Teilfreistellung 30%)  buy 10 @ 100, sell 10 @ 150
//        realized 500; counts as 500 × (1 − 0.30) = 350               -> general pot +350
//   DIV   (equity, still held)  buy 5 @ 50; a EUR 400 dividend (2025-06-01)
//        dividend income                                              -> general pot +400
//
// pots: stock 600 + general 750 = 1,350 counts against the allowance (no losses to net).
// allowance used = 1,000; taxable excess = 1,350 − 1,000 = 350.
// tax by its statutory parts: Abgeltungsteuer 350 × 25% = 87.50, Soli 5.5% × 87.50 = 4.8125,
// total 92.3125 (= 350 × 26.375%); the API reports amounts to the cent: 92.31.
export const deTax: Ledger = {
  name: "de-tax",
  asOf: "2026-02-15T12:00:00.000Z",
  displayCurrency: "EUR",
  holders: { me: { name: "Holder", taxAllowanceAnnual: "1000" } },
  portfolios: {
    depot: {
      name: "Depot",
      baseCurrency: "EUR",
      cashCounted: false,
      holder: "me",
      taxAllowanceAnnual: "1000",
    },
  },
  instruments: {
    stock: {
      symbol: "STOCK",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "Stock AG",
      price: "170",
    },
    fund: {
      symbol: "FUND",
      market: "XETRA",
      assetClass: "etf",
      currency: "EUR",
      name: "World ETF",
      price: "150",
    },
    div: {
      symbol: "DIV",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "Dividend AG",
      price: "50",
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
      at: "2025-01-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "sell",
      instrument: "stock",
      quantity: "10",
      price: "160",
      currency: "EUR",
      at: "2025-05-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "buy",
      instrument: "fund",
      quantity: "10",
      price: "100",
      currency: "EUR",
      at: "2025-01-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "sell",
      instrument: "fund",
      quantity: "10",
      price: "150",
      currency: "EUR",
      at: "2025-05-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "buy",
      instrument: "div",
      quantity: "5",
      price: "50",
      currency: "EUR",
      at: "2025-02-01T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "dividend",
      instrument: "div",
      price: "400",
      currency: "EUR",
      at: "2025-06-01T10:00:00.000Z",
    },
  ],
};

export const deTaxExpected = {
  year: 2025,
  stockPot: "600",
  generalPot: "750", // 350 (ETF after Teilfreistellung) + 400 dividend
  taxableBeforeAllowance: "1350",
  allowanceUsed: "1000",
  taxableExcess: "350",
  estimatedTax: "92.3125", // 87.50 + 4.8125; the route rounds to cents (92.31)
};
