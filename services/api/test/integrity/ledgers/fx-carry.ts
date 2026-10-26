import type { Ledger } from "../ledger.js";

// FX carry-forward is bounded (FX_MAX_CARRY_FORWARD_DAYS = 14): the latest cached rate on or
// before today stands in for today's, but an older one counts as MISSING rather than being
// presented as today's. Two ledgers differ only in how old the rate is, and both use a
// currency no other ledger quotes (fx_rates rows are global).
//
//   buy 10 @ 100 in a foreign currency, quote 100; the only rate is dated 2026-07-05.
function ledger(name: string, asOf: string, currency: string, rate: string): Ledger {
  return {
    name,
    asOf,
    displayCurrency: "EUR",
    portfolios: { depot: { name: "Depot", baseCurrency: "EUR", cashCounted: false } },
    instruments: {
      fgn: {
        symbol: "FGN",
        market: "LSE",
        assetClass: "equity",
        currency,
        name: "Foreign plc",
        price: "100",
      },
    },
    fx: [{ base: currency, quote: "EUR", rate, date: "2026-07-05" }],
    transactions: [
      {
        portfolio: "depot",
        type: "buy",
        instrument: "fgn",
        quantity: "10",
        price: "100",
        currency,
        at: "2026-02-10T10:00:00.000Z",
      },
    ],
  };
}

// 2026-07-10 is 5 days after the rate: carried forward. Value = 10 × 100 × 0.85 = 850.
// (A clock still frozen at an earlier ledger's 2026-06-30 would see the rate as dated in the
// future and report the currency missing, so this also proves each describe re-freezes time.)
export const fxCarry = ledger("fx-carry", "2026-07-10T12:00:00.000Z", "GBP", "0.85");
export const fxCarryExpected = { netWorth: "850", fxMissingCurrencies: [] as string[] };

// 2026-07-20 is 15 days after the rate: older than the window, so missing, not "today's" rate.
export const fxStale = ledger("fx-stale", "2026-07-20T12:00:00.000Z", "CHF", "0.95");
export const fxStaleExpected = { netWorth: "0", fxMissingCurrencies: ["CHF"] };
