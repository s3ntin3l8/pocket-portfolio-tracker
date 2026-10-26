import type { Ledger } from "../ledger.js";

// The Freistellungsauftrag has two levels (CLAUDE.md, docs/tax.md): the holder's legal cap and
// each depot's allocated slice. The tax is netted against the DEPOT's slice; the cap only drives
// the over-allocation warning. Tax year 2025, holder cap EUR 1,000, an explicit 28% rate.
//
//   depot a (slice 400):  STOCK buy 10 @ 100 (2025-01-10), sell 10 @ 160 (2025-05-10)
//        realized 600 -> stock pot +600
//   depot b (slice 800):  no trades
//
// a: allowance used = min(600, 400) = 400; taxable excess = 600 − 400 = 200;
//    tax = 200 × 28% = 56 (the holder's explicit rate always wins over the 26.375% default).
// holder distribution: slices 400 + 800 = 1,200 allocated against a cap of 1,000 -> over-allocated
// (a warning only; each depot still uses its own slice).
export const deTaxSlice: Ledger = {
  name: "de-tax-slice",
  asOf: "2026-02-15T12:00:00.000Z",
  displayCurrency: "EUR",
  holders: { me: { name: "Holder", taxAllowanceAnnual: "1000", capitalGainsTaxRate: "0.28" } },
  portfolios: {
    depot: {
      name: "Depot A",
      baseCurrency: "EUR",
      cashCounted: false,
      holder: "me",
      taxAllowanceAnnual: "400",
    },
    other: {
      name: "Depot B",
      baseCurrency: "EUR",
      cashCounted: false,
      holder: "me",
      taxAllowanceAnnual: "800",
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
  ],
};

export const deTaxSliceExpected = {
  year: 2025,
  taxRate: "0.28",
  allowanceAnnual: "400",
  stockPot: "600",
  allowanceUsed: "400",
  taxableExcess: "200",
  estimatedTax: "56",
  holderAllowanceCap: "1000",
  totalAllocated: "1200",
};
