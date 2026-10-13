# Tax Reporting

How the tracker estimates tax for two structurally different regimes — German
realization-based capital-gains tax and Indonesian final (withholding-style) tax — and
the user-level switch between them. **Both are estimates, not tax advice** (see the
"out of scope" notes below); the tracker doesn't file anything, it surfaces the numbers
you'd need to.

## The `taxRegime` switch

`userPreferences.taxRegime` (`packages/db/src/schema.ts`) is a per-user, global setting —
`"DE"` (default) or `"ID"` — read/written via `GET`/`PUT /me/preferences`
(`services/api/src/routes/preferences.ts`). It decides which of the two modules below
computes tax-facing numbers for every portfolio the user owns; there is no per-portfolio
override.

- **`"DE"`** — German Sparerpauschbetrag/Kapitalertragsteuer logic
  (`packages/core/src/tax.ts`), realization-based: tax depends on _closed_ gains,
  netted against a per-holder annual allowance.
- **`"ID"`** — Indonesian final-tax logic (`packages/core/src/tax-id.ts`): a flat rate
  applied to _gross proceeds/income_, withheld at source, with no allowance or
  loss-netting concept at all.

**Ordering gotcha:** `GET /portfolios/:id/sparplan` (`services/api/src/routes/
transactions/sparplan.ts`) reads `taxRegime` _before_ checking whether the portfolio's
FSA (`taxAllowanceAnnual`) is configured. An Indonesian user will almost never have an
FSA set, so if the FSA guard ran first (as it originally did) the `"ID"` branch would
never be reached — it would always short-circuit to `taxUnavailable: true`. If you touch
this route, keep the regime check first.

This is unrelated to `costBasisMode` (see [below](#costbasismode-not-a-tax-setting)),
which is a separate global preference that affects P&L/cost-basis math, not tax.

## German regime (`packages/core/src/tax.ts`)

Computes YTD usage of the **Sparerpauschbetrag** (§20 EStG annual tax-free allowance)
from a FIFO `TradeLog`, plus tax-loss-harvesting suggestions. Explicitly **out of
scope**: church-tax surtax calculation, Günstigerprüfung (the option to have gains taxed
at one's personal income-tax rate instead of the flat Kapitalertragsteuer, when that's
cheaper).

### Two-level Freistellungsauftrag (FSA) — don't conflate these

There are two different `taxAllowanceAnnual` columns, on two different tables:

| Column                              | Meaning                                                                                                                                      | Scope         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `accountHolders.taxAllowanceAnnual` | The **legal cap**: how much Sparerpauschbetrag this real person actually has (default €1,000 single / €2,000 jointly assessed with a spouse) | Per holder    |
| `portfolios.taxAllowanceAnnual`     | The **allocation**: how much of that cap this specific depot's FSA is set to                                                                 | Per portfolio |

A holder with two depots might set portfolio A's FSA to €600 and portfolio B's to €400,
summing to their €1,000 cap. `GET /portfolios/:id/tax` computes this distribution
(`totalAllocatedForHolder` vs. `holderAllowanceCap` in `services/api/src/routes/
transactions/tax.ts`) and returns it as `holderDistribution` — the edit modal uses it to
show "€X of €cap allocated" and to raise an `overAllocated` warning. **This is a warning
only, not a DB constraint** — nothing stops you from over-allocating across portfolios;
the tax computation for each portfolio still uses that portfolio's own
`taxAllowanceAnnual` regardless.

A portfolio with no FSA configured (`taxAllowanceAnnual` is `null`) can't compute German
tax at all — the route returns `422 tax_allowance_not_configured`, and the `/sparplan`
route returns `taxUnavailable: true` instead of erroring.

### Tax rate (`capitalGainsTaxRate` / `churchTax`)

`effectiveCapitalGainsTaxRate` (`packages/core/src/tax/rates.ts`) resolves the flat rate
used for "tax saving" figures, in this order:

1. The holder's explicit `accountHolders.capitalGainsTaxRate`, if set (always wins).
2. Otherwise, with `churchTax` unset: Abgeltungsteuer 25% + Solidaritätszuschlag 5.5% of
   it = **26.375%** (previously a bare 25%).
3. Otherwise, with `churchTax` set (§32d Abs. 1 EStG): the Kapitalertragsteuer is reduced
   because the church tax is deductible, `e = 25% / (1 + 0.25·k)`, and the total is
   `e · (1 + 0.055 + k)` with `k` = church-tax rate on the KapESt (default **9%**; 8% in
   Baden-Württemberg and Bayern, passed as `churchTaxRate`). k = 9% gives 27.9951%,
   k = 8% gives 27.8186%. `churchTax` is a boolean, so 9% is assumed unless an explicit
   rate is configured.

### Holding period (§23 EStG)

Gold/crypto gains are tax-free only if held **more than one year**. The test is calendar
arithmetic (`heldMoreThanOneYear`, `packages/core/src/trade-log/helpers.ts`): a sale on
the one-year anniversary is still inside the period, the next day is not, and a 29 Feb
acquisition ends on 28 Feb (§188 Abs. 2 BGB) — no 365-day count, so leap years are right.
Long-term flags are decided **per lot**: a FIFO leg by its own lot; an average-method leg
only if every lot consumed by that sale is older than a year, so a recent top-up does not
inherit the first lot's status. An open trade is long-term when every lot still held is.

### Teilfreistellung (partial exemption)

Fund gains/losses, fund **distributions** and Vorabpauschale are multiplied by
`(1 − tfRate)` before counting against the allowance. Distributions are carried
per instrument in `TradeLog.incomeByInstrumentYear` (the instrument-attributed part of
`dividendsByYear`); instrument-less income such as account interest stays unadjusted.
An equity-ETF distribution of €100 therefore counts as €70 in the general pot. The rate comes from `instruments.partialExemptionRate` when set,
else a default by asset class (`defaultPartialExemptionRate` in `packages/core/src/tax/rates.ts`,
applied by `buildTfRates` in `services/api/src/routes/transactions/tax-helpers.ts`):
ETF → **30%**, mutual fund → **15%**, everything else → **0%** (no exemption). The
class default is only a fallback: bond/real-estate/mixed funds have different statutory
rates (e.g. 60% real estate, 15% mixed), so the **per-instrument
`instruments.partialExemptionRate` is the documented override**. Admins set it in the
instrument edit dialog (percent, fund classes only; blank clears it) via
`PATCH /instruments/:id` (`partialExemptionRate`, a fraction 0–1 or `null`). Worked
example (from `packages/core/test/tax.test.ts`): a closed equity-ETF trade with a
€1,000 realized gain and a 30% Teilfreistellung rate tf-adjusts to **€700** — against a
€1,000 allowance, that leaves €300 remaining.

### Two-pot loss netting (Verlustverrechnungstöpfe)

Gains/losses are split into two pots:

- **Aktienverlusttopf (stock pot)** — realized share-sale (assetClass `"equity"`)
  gains/losses only.
- **Allgemeiner Verlusttopf (general pot)** — fund/bond/derivative gains/losses, all
  dividend/interest/coupon income, and the Vorabpauschale net (accrual − credit).

**Netting is one-way (§20 Abs. 6 EStG, owner-confirmed):** a loss in the _general_ pot
offsets _stock_ gains; a loss in the _stock_ pot only ever offsets stock gains, never
general gains. `computePotsUsage` (`packages/core/src/tax-helpers.ts`) applies each pot's
own carry-forward first, then nets a still-negative general pot against the stock gain
before clamping; whatever is still negative afterwards is carried forward separately
(the stock loss in the stock pot, the remaining general loss in the general pot).

| Stock pot | General pot | Counts against allowance | Note                                |
| --------- | ----------- | ------------------------ | ----------------------------------- |
| +1,000    | −400        | 600                      | general loss nets the stock gain    |
| −1,000    | +400        | 400                      | stock loss carried forward, unused  |
| −400      | +1,000      | 1,000                    | stock loss NOT used on general gain |
| +400      | −1,000      | 0                        | 600 general loss carried forward    |

`lossCarryForward.general` follows the same direction (a general carry-forward larger
than the general subtotal also absorbs stock gains); `lossCarryForward.stock` only ever
reduces the stock pot. **Gold and crypto are excluded from both
pots entirely**: they fall under §23 EStG private-sale rules, a separate regime from the
§20 Kapitalerträge this allowance covers. The same exclusion applies to harvest
suggestions (they never propose realising gold/crypto gains "to use the allowance").

A per-pot, per-holder **loss carry-forward** from the prior year's tax certificate
(`lossCarryforward` table, keyed by `holderId` + `taxYear` + `pot`) is subtracted from
that pot's net gain/loss before its floor — it's a settled raw euro figure, already
Teilfreistellung-adjusted when originally booked, never re-adjusted here. It's only
applied when a holder has exactly one portfolio (`carryForwardApplied` in the route);
splitting one holder's trades across multiple portfolios and expecting the same
carry-forward to apply to each independently isn't supported.

### Vorabpauschale (§18(3) InvStG advance lump-sum fund tax)

Split across two files by responsibility: `trade-log.ts` owns the _share-accounting_
side (per-instrument accrual pool on `Trade.vorabByYear`, and a disposal credit on
`TradeLeg.vorabCredit` to avoid double-taxing the same amount when the fund is later
sold); `tax.ts` owns the _tax-netting_ side — it Teilfreistellung-adjusts both the
accrual and the credit, in the same per-trade loop that handles realized gains, and
folds the net (accrual − credit) into the general pot.

### Basiszins and the Vorabpauschale

The Vorabpauschale base normally comes from the broker (`vorabBase` on the `tax`/
`vorabpauschale` row). `BASISZINS_BY_YEAR` (`packages/core/src/tax/rates.ts`) holds the
official Basiszins (§18 Abs. 4 InvStG, derived by the Bundesbank at the first trading day
of the year and published by the Bundesfinanzministerium). Sources (BMF-Schreiben
"Basiszins zur Berechnung der Vorabpauschale gem. § 18 Absatz 4 InvStG"; all four values
re-checked against the letters, Oct 2026):

| Year | Basiszins | BMF-Schreiben                                                 |
| ---- | --------- | ------------------------------------------------------------- |
| 2023 | 2.55%     | 4 Jan 2023                                                    |
| 2024 | 2.29%     | 5 Jan 2024, IV C 1 - S 1980-1/19/10038 :008                   |
| 2025 | 2.53%     | 10 Jan 2025, IV C 1 - S 1980/00230/009/002                    |
| 2026 | 3.20%     | Jan 2026, IV C 1 - S 1980/00230/012/001 (BStBl 2026 I S. 155) |

A year with no entry returns `null` and logs a warning — values are never guessed.

### Estimated Vorabpauschale (when the broker books none)

For German-regime fund holdings (`etf`, `mutual_fund`) the tax route derives the missing
accrual itself — `estimateVorabRows` (`packages/core/src/tax/vorab-estimate.ts`), loaded
from `prices` by `services/vorab-estimate.ts` and fed into the same trade log as the
broker rows. The rows are **derived, never stored**, carry `estimated: true`, and surface as
`vorabByYear[].estimated` / `AllowanceUsage.vorabpauschaleEstimated` (the Tax page labels
the accrued figure "Estimated from year-start and year-end prices"). Rules (§18 InvStG,
verified against the statute text):

- **Per unit, full year** (Abs. 1): `Basisertrag = price at start of year × Basiszins ×
70%`, capped at the actual increase (`price at year end − price at start + distributions`),
  minus the distributions already paid, floored at 0. The start/end price is the latest
  stored close on or before 1 Jan / 31 Dec (at most 5 days back — an older close is a miss).
- **Purchase year** (Abs. 2): the _Vorabpauschale itself_ (after the cap and distributions)
  is reduced by 1/12 for every full month before the purchase month. The cap uses the
  year's first/last price for every unit, whenever it was bought.
- **Only units held at 31 Dec** count (lots are consumed FIFO by sales/`transfer_out`);
  units sold during the year get none. The statute text does not spell this out; it follows
  the Vorabpauschale arising at year end (a sale before then settles via the disposal gain).
- **Deemed received** (Abs. 3) on the first working day of the next year
  (`vorabZuflussDate`: weekends skipped, e.g. 4 Jan 2027 for 2026), so the accrual lands in
  year Y+1's allowance figures — the same year a broker row would be dated.
- **A broker row always wins:** if a `vorabpauschale` row is dated December Y or in January–November of Y+1
  for the instrument, no estimate is made for Y. The next broker import therefore replaces the
  estimate without any cleanup.
- **No row rather than a wrong one:** a missing boundary price, a price quoted in another
  currency than the transactions, or a year without a Basiszins produces no estimate (and a
  logged warning) — never a zero or guessed base. Years before 2023 (no table) are not
  estimated. A split/bonus in the year is handled by bringing both quantities and prices to
  current share terms.

Staleness: the estimate sits inside the FIFO trade-log cache, so it is as fresh as the
valuation that feeds it (60 s TTL, cleared on any write); a background price backfill shows
up at the next TTL expiry.

### Harvest suggestions

`harvestSuggestions()` ranks open positions by tf-adjusted unrealized gain and shows how
much of each could be realized against the _remaining_ allowance — each suggestion is
computed **independently** against the same `remaining` figure (a per-row "if I harvest
only this one" ceiling), not sequentially. `harvestSummary()` is the sequential version:
it walks a list of suggestions best-first and allocates the _shared_ remaining allowance
across them, so the combined total never exceeds `remaining × taxRate` (naively summing
independent per-row suggestions would overcount, since each row assumes the full
allowance is still available).

Both use `projectedRemaining` when a rest-of-year income forecast is available
(`restOfYearForecastGross()` in `tax.ts`'s route file — projects dividends via each
instrument's trailing-12-month withholding ratio, announced `dividend_events`, and bond
coupons), falling back to the realized `remaining` otherwise.

### Where it surfaces

- `GET /portfolios/:portfolioId/tax` — single-portfolio allowance usage + harvest
  suggestions + FSA distribution.
- `GET /networth/tax` — aggregated across all of a holder's portfolios (or filtered by
  `holderId`), merging trade logs with `mergeTradeLogs()` before computing usage.
- `/tax` page in the web app renders both, including the FSA over-allocation warning.

## Indonesian final-tax regime (`packages/core/src/tax-id.ts`)

A flat, **withheld-at-source** tax with no annual allowance, no loss-netting, and no
realization dependency on when a gain was locked in — it taxes _proceeds and gross
income_, not gains:

| Event                         | Rate     | Base                                                                     |
| ----------------------------- | -------- | ------------------------------------------------------------------------ |
| Disposal of IDX-listed shares | **0.1%** | Gross sale proceeds (not gain)                                           |
| Dividend / coupon income      | **10%**  | Gross amount (net received + any withholding already on the transaction) |

The 0.1% sales tax is scoped to `market === "IDX" && assetClass === "equity"`
(`computeIndonesianFinalTaxFromTradeLog` in `services/api/src/routes/transactions/
tax-helpers.ts`); gold, crypto, foreign-listed ETFs/stocks and bonds incur none, in both
the per-disposal rows and the by-year rollup. Dividend rows are display-currency
amounts and are labelled with the display currency (not the transaction's native one).

**Design-fidelity note (intentional):** dividend/coupon tax is always computed as
`gross × 10%`, ignoring whatever a broker may have already withheld on the underlying
transaction. This mirrors the flat-estimate framing used for the German path too ("an
estimate, not a filed tax figure") — it is not meant to net against real withholding, so
it isn't a bug to "fix" if the numbers don't match a real Indonesian tax bill.

Realized gain (`IdYearInput.realized` / `IdDisposalLot.gain`) is carried through the
output purely for display — it's informational, since ID final tax is never actually
levied on gains.

Unlike the DE path, this module has no dedicated API route. It's computed directly in
the web app's server components (`apps/web/src/app/[locale]/(app)/tax/
tax-detail-section.tsx`, `apps/web/src/app/[locale]/(app)/reports/page.tsx`) from a
trade log that page already loaded, since the computation is a stateless roll-up with no
allowance/carry-forward state to fetch.

## `costBasisMode` — not a tax setting

`userPreferences.costBasisMode` (`"purchase_price"` default, or `"total_paid"`) is a
**separate** global preference. Server-side it is resolved by `resolveCostBasisMode`
(`services/api/src/routes/transactions/shared/helpers.ts`): an explicit valid
`?costBasis=` query wins, otherwise the saved preference — used by the tax, contributions,
history, sparplan, trades, holdings and net-worth routes.
It is a **separate** global preference from `taxRegime` — it changes how cost basis is computed
for FIFO/average-cost trade logs and P&L generally (`packages/core/src/valuation.ts`,
`CostBasisMode`), not anything tax-specific. It's unrelated to either tax module above;
don't assume a `taxRegime` change implies a `costBasisMode` change or vice versa. (A
same-named `costBasisMode` column also exists on the `loans` table for gold cicilan
contracts — display-only there, purely about which cost figure a loan's summary shows,
and entirely unrelated to this user-level preference.)

## References

- `packages/core/src/tax.ts` — German Sparerpauschbetrag/Teilfreistellung/two-pot
  netting/Vorabpauschale/harvest logic.
- `packages/core/src/tax-id.ts` — Indonesian final-tax logic.
- `packages/core/src/trade-log.ts` — `Trade.vorabByYear` / `TradeLeg.vorabCredit`
  (Vorabpauschale share-accounting), FIFO/average trade-log construction.
- `packages/core/src/valuation.ts` — `CostBasisMode`.
- `services/api/src/routes/transactions/tax.ts` — `/portfolios/:id/tax`,
  `/networth/tax`, rest-of-year income forecast.
- `services/api/src/routes/transactions/sparplan.ts` — the `taxRegime`-before-FSA-guard
  ordering.
- `services/api/src/routes/preferences.ts` — `GET`/`PUT /me/preferences`.
- `packages/db/src/schema.ts` — `userPreferences.taxRegime`/`costBasisMode`,
  `accountHolders.taxAllowanceAnnual`/`capitalGainsTaxRate`/`churchTax`/`taxResidence`,
  `portfolios.taxAllowanceAnnual`, `lossCarryforward`, `instruments.partialExemptionRate`.
- `apps/web/src/app/[locale]/(app)/tax/`, `apps/web/src/app/[locale]/(app)/reports/` —
  the pages that render both regimes.
