import type { Ledger } from "../ledger.js";

// One-way loss netting (§20 Abs. 6 EStG, docs/tax.md "Two-pot loss netting"): a loss in the
// stock pot is NOT used against general-pot income. Tax year 2025, holder allowance EUR 200.
//
//   STOCK  buy 10 @ 100 (2025-01-10), sell 10 @ 60 (2025-05-10)  realized 10 × (60 − 100) = −400
//                                                                   -> stock pot −400 (carried, unused)
//   interest of EUR 1,000 on the account (2025-06-01, no instrument, no Teilfreistellung)
//                                                                   -> general pot +1,000
//
// docs table row "stock −400, general +1,000": 1,000 counts against the allowance.
// taxable excess = 1,000 − 200 = 800; tax = 800 × 25% = 200.00, Soli 5.5% × 200 = 11.00, total 211.
export const deTaxPots: Ledger = {
  name: "de-tax-pots",
  asOf: "2026-02-15T12:00:00.000Z",
  displayCurrency: "EUR",
  holders: { me: { name: "Holder", taxAllowanceAnnual: "200" } },
  portfolios: {
    depot: {
      name: "Depot",
      baseCurrency: "EUR",
      cashCounted: false,
      holder: "me",
      taxAllowanceAnnual: "200",
    },
  },
  instruments: {
    stock: {
      symbol: "STOCK",
      market: "XETRA",
      assetClass: "equity",
      currency: "EUR",
      name: "Stock AG",
      price: "60",
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
      price: "60",
      currency: "EUR",
      at: "2025-05-10T10:00:00.000Z",
    },
    {
      portfolio: "depot",
      type: "interest",
      price: "1000",
      currency: "EUR",
      at: "2025-06-01T10:00:00.000Z",
    },
  ],
};

export const deTaxPotsExpected = {
  year: 2025,
  stockPot: "-400",
  generalPot: "1000",
  taxableBeforeAllowance: "1000", // the stock loss is not netted against the general pot
  allowanceUsed: "200",
  taxableExcess: "800",
  estimatedTax: "211", // 800 × 0.26375
};
