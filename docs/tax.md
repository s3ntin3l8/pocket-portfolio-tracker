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
- **`"ID"`** — Indonesian final-tax logic (`packages/core/src/tax-id.ts`): fixed final
  rates on _gross proceeds_ and on each _type_ of investment income, with no allowance or
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

**Both columns — and the loss carry-forward below — are euro amounts** (the Sparerpauschbetrag
is set in law in EUR; `DE_TAX_AMOUNT_CURRENCY` / `DE_TAX_ALLOWANCE_DEFAULT_EUR` in
`services/api/src/routes/transactions/tax-helpers.ts`). The DE trade log they are netted against is
in the display currency (`/networth/tax`) or the portfolio's base currency (`/portfolios/:id/tax`,
the Sparplan harvest cap), so `eurTaxAmountsIn` converts them into that currency first: an IDR view
nets a €1,000 allowance as ≈ IDR 17M, not IDR 1,000. A missing EUR rate is never 1:1 — the allowance
and carry-forward are then unavailable (0, so all income counts as taxable) and `EUR` is reported in
`fxMissingCurrencies`. The distribution helper (`holderDistribution` / `distribution`) compares
euro with euro and says so with `currency: "EUR"`; the web formats it in EUR.

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

### Foreign withholding (§32d Abs. 5 EStG)

The tax on the year's taxable excess is reduced by foreign tax that was actually withheld
on a dividend, coupon or interest. It does not reduce the Sparerpauschbetrag, and it is
not estimated from the Indonesian resident rates.

- A source breakdown (`transaction_sources.taxComponents`) credits only `quellensteuer`.
  Kapitalertragsteuer, Solidaritätszuschlag and Kirchensteuer stay German tax already
  withheld.
- With no breakdown, `transactions.tax` is credited only when the row is Indonesian income:
  `domestic_dividend`, `bond_interest` or `deposit_interest`. A German share's tax is not
  a credit. A row with no recorded withholding is not given 10% or 20%.
- Each row is capped at 25% of that row's German taxable gross, after Teilfreistellung.
- The year is capped at the German tax on the taxable excess. At the statutory **26.375%**
  the credit reduces the 25% Kapitalertragsteuer and the 5.5% Solidaritätszuschlag is
  recomputed on what remains. A holder-specific rate (including church tax) is reduced by
  the credit and floored at zero; that rate is not split back into its parts.
- The 0.1% IDX sales levy, the crypto sales tax and the bond-discount tax are taxes on a
  sale, not on the income, and are not credits.

`allowanceUsage.foreignTaxCredit` is what was applied. `allowanceUsage.estimatedTax` is the
tax after it. Both are in the trade log's currency.

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

For German-regime fund holdings (`etf`, `mutual_fund`) the API derives the missing
accrual itself — `estimateVorabRows` (`packages/core/src/tax/vorab-estimate.ts`), loaded
from `prices` by `services/vorab-estimate.ts` and fed into the same trade log as the
broker rows. Every DE-regime consumer of the trade log gets it, so a sell's Vorabpauschale
credit is the same everywhere: the Tax routes (`/portfolios/:id/tax`, `/networth/tax`), the
Trades routes (`/portfolios/:id/trades`, `/networth/trades`) and the Sparplan harvest cap
(`/portfolios/:id/sparplan?includeSales=true`). Under the ID regime none of them add rows. The rows are **derived, never stored**, carry `estimated: true`, and surface as
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
- **A broker row with a base always wins:** if a `vorabpauschale` row that carries a `vorabBase` is dated
  December Y or in January–November of Y+1 for the instrument, no estimate is made for Y. The next broker
  import therefore replaces the estimate without any cleanup. A row without a base (the Trade Republic CSV
  `EARNINGS` row has only the tax withheld) is a plain cash debit linked to the fund; it does not replace the
  estimate, since the trade log would book no accrual for that year. The CSV row is linked by the ISIN in its
  booking text, only to a fund the portfolio already trades; it never creates an instrument.
- **No row rather than a wrong one:** a missing boundary price, a price quoted in another
  currency than the transactions, or a year without a Basiszins produces no estimate (and a
  logged warning) — never a zero or guessed base. Years before 2023 (no table) are not
  estimated. A split/bonus in the year is handled by bringing both quantities and prices to
  current share terms.

Price lookups are batched: `getPricesOn` runs one query for all boundary dates, and the
multi-portfolio routes (`/networth/tax`, `/networth/trades`) load every portfolio's valuation
first, then make ONE `loadVorabPrices` call over the union of fund ids and years, shared by
all portfolios (`estimateVorabFromPrices` per portfolio).

Staleness: `/portfolios/:id/tax` computes the estimate lazily inside the FIFO trade-log cache;
`/portfolios/:id/trades` and `/networth/trades` inside their derivation caches, keyed by tax
regime so a regime switch never serves a stale log. `/networth/tax` and Sparplan are not
cached at that level (the valuations they read are). All are as fresh as the valuation that
feeds them (60 s TTL, cleared on any write); a background price backfill shows up at the next
TTL expiry.

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

Final taxes for a **resident individual**, with no annual allowance, no loss-netting and no
dependency on when a gain was locked in. They tax _proceeds and gross income_, not gains,
and the rate depends on the type and the source of the income:

| Event (category)                                                        | Rate      | Base                                                  | Who pays                                     | Rule                                                                                                       |
| ----------------------------------------------------------------------- | --------- | ----------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sale of IDX-listed shares                                               | **0.1%**  | Gross sale value, quantity × price, before commission | Withheld by the exchange via the broker      | PP 41/1994 as amended by PP 14/1997; KMK 282/KMK.04/1997                                                   |
| Crypto sale (`cryptoDisposals`)                                         | by venue  | Gross sale value, quantity × price, fees excluded     | Withheld at source                           | PMK 68/2022 from 1 May 2022; PMK 50/2025 from 1 Aug 2025. Not the 0.1%. See below                          |
| Gold-bar sale to an LJK Bulion (`goldDisposals`)                        | **0.25%** | Gross sale value above Rp10,000,000                   | Withheld at source, **not final**            | PMK 51/2025 and PMK 52/2025 from 1 Aug 2025. Not in `estimatedTax` or `taxToSelfPay`. See below            |
| Dividend of an Indonesian company (`domestic_dividend`)                 | **10%**   | Gross dividend                                        | The investor, by the 15th of the next month  | UU PPh Art. 4(3)(f), 17(2c) as amended by UU HPP 7/2021; PMK 18/2021; PMK 81/2024 Art. 370–374             |
| Bond interest / coupon, SBN retail included (`bond_interest`)           | **10%**   | Gross interest for the holding period                 | Withheld by the issuer or custodian          | PP 91/2021 Art. 2 (from 30 Aug 2021; 15% before). Coupons use today's 10% unless a withholding is recorded |
| Bond / sukuk discount (`bond_discount`)                                 | **10%**   | Clean sale price − clean cost, × quantity, fees out   | Withheld at source                           | PP 91/2021 Art. 2(3). 15% on a sale before 30 Aug 2021. Not the 0.1% share tax                             |
| Bank deposit, savings and current-account interest (`deposit_interest`) | **20%**   | Gross interest                                        | Withheld by the bank                         | PP 131/2000 as amended by PP 123/2015; PMK 212/PMK.03/2018; 0% when the balance is ≤ Rp7.5M (below)        |
| Reksa dana / IDX ETF / DIRE distribution (`fund_distribution`)          | **0%**    | —                                                     | Not an income-tax object for the unit holder | UU PPh Art. 4(3)(i)                                                                                        |
| Foreign-source income (`foreign`)                                       | marginal  | Gross, in the annual return                           | The investor, with a foreign tax credit      | UU PPh Art. 17 (5–35%), Art. 24; PMK 192/PMK.03/2018                                                       |

`estimatedTax` = sales tax + the final tax on the Indonesian income. It is split into
`taxWithheldAtSource` (share sales, crypto sales, bond interest, bond discount and bank
interest: the payer already withheld it) and `taxToSelfPay` (domestic dividends that are not
attested as reinvested). Gold-bar PPh 22 is withheld but it is not a final tax, so it is
in neither figure. The Tax page
shows both in the hero card and labels each income row "withheld at source" or "you pay", so
withheld tax doesn't read as tax still owed.

The 0.1% is computed from quantity × price (fees excluded): the trade log's
`nativeGrossProceeds`, converted into the report currency at the **sale date**.
`grossProceeds` is that same figure at the valuation rate and stays the performance
number; the tax report does not re-rate it. An oversell is taxed only
on the quantity actually held. A withholding recorded on the sell (`transactions.tax`) is the
tax for that disposal, scaled by the same fraction; the 0.1% applies only when none is
recorded. A zero there is not an exemption. A separate `tax` transaction is not added on top.
`byYear` uses that same decided amount. Crypto sales tax is added in the same year column
and is not part of `totalSalesTax`.

### Crypto sales (PMK 68/2022, PMK 50/2025)

A sale of an instrument with `assetClass === "crypto"` can produce a `cryptoDisposals` row.
The base is quantity × price (fees excluded), converted at the sale date the same way as
the 0.1%. Gain is
ignored, so a sale below cost is still taxed. Buys are not taxed. The old PPN (0.11% /
0.22%) is not modelled.

The rate follows the **portfolio**, not the coin. `portfolios.cryptoTaxVenue` is `domestic`
(an Indonesian PAKD/PPMSE) or `foreign`. Null means `domestic` when `portfolios.country` is
`ID`, and no crypto sales tax otherwise — a German Binance book does not grow an Indonesian
estimate just because the asset is crypto. There is no per-sale override.

| Sale date               | Domestic    | Foreign     |
| ----------------------- | ----------- | ----------- |
| before 2022-05-01       | no estimate | no estimate |
| 2022-05-01 – 2025-07-31 | 0.10%       | 0.20%       |
| from 2025-08-01         | 0.21%       | 1%          |

A date with no estimate and no recorded withholding is omitted. A withholding recorded on
the sell wins. `totalCryptoTax` is folded into `estimatedTax` and `taxWithheldAtSource`. It
is not added to the 0.1% share total (`totalSalesTax` / the share-sales table). On a holder
view each portfolio is judged on its own venue before the trade logs are merged.

### Gold bars (PMK 51/2025, PMK 52/2025)

An end consumer selling gold bars to an LJK Bulion on or after **1 Aug 2025** can produce
a `goldDisposals` row. The base is the sale's quantity × price (fees excluded), one row
per sell transaction. At or under **Rp10,000,000** there is no PPh 22. Above that, the
institution withholds **0.25%** of the purchase price. A consumer buying bars is not taxed.

The sale counts only when it is Indonesian: the sale currency is IDR, the instrument is
one this report already treats as Indonesian, or the portfolio's country is `ID`. A gold
sale in another book is unchanged. A gold ETF booked as `etf` or `mutual_fund` stays a
fund distribution at 0% and is not this, and it is not an IDX share sale.

PPh 22 here is a withholding, not one of the final taxes. The row is shown
(`totalGoldTax`) and is not added to `estimatedTax`, `taxWithheldAtSource`, `taxToSelfPay`
or the 0.1% (`totalSalesTax`). There is no NPWP flag, so the pre-August Antam buyback
rates (1.5% / 3% under PMK 34/2017) are not estimated: a sale before 2025-08-01 with no
recorded withholding is omitted. A withholding recorded on the sell is the figure shown,
including under the threshold and before that date.

### Bond and sukuk discount (PP 91/2021 Art. 2(3))

A sale or redemption of an Indonesian bond or sukuk can also produce a `bond_discount` row,
beside any coupons. The base is `(clean sale price − clean cost) × quantity`. Both prices
are the transaction's `price` (per unit, not a percent of par — an ORI with face value
1,000,000 bought at `1000000` is at par). Fees are excluded: the trade log's `cleanCost` is
quantity × buy price, while `cost` still includes fees for gain and XIRR. Sale value and
clean cost both convert at the **sale date** (one rate). `grossProceeds` is
the sale side at the valuation rate.

- **Par adds nothing.** A redemption at the same clean price as the purchase (the demo
  ORI020) emits no discount row. Coupons on that bond are still taxed as `bond_interest`.
- **Above cost** is a positive discount, 10% final, withheld at source. It is not the 0.1%
  share tax, and it does not appear in the sales-tax disposals. It counts in `estimatedTax`
  and `taxWithheldAtSource`.
- **Below cost** is informational. Tax is zero, `exemption` is `negative_discount`, and the
  negative amount does not reduce coupons already booked. PP 91/2021 Art. 2(4) lets a
  negative discount offset accrued coupon that has not yet been taxed; this estimate does
  not compute that offset, so it does not invent a refund.
- **A withholding recorded on the sell wins**, scaled to the quantity actually sold, the
  same way as the 0.1%. Zero or blank is not an exemption.
- **The 15% → 10% cutover is applied to the discount, on the sale date.** Before
  2021-08-30 with no recorded tax, the rate is 15%; from that date it is 10%. A 15% row
  and a 10% row in the same year stay separate. Coupons are unchanged: they stay at today's
  10% unless a withholding is recorded.
- **The price is clean.** Do not strip bunga berjalan, and do not book a dirty price in
  `transactions.price`. A dirty price (clean price plus accrued interest) would overstate
  the discount, because the accrued coupon is already taxed when it is paid.
- **Short tenor is outside this 10%.** PP 91's "obligasi" does not cover paper of 12 months
  or less (SPN and the like). No issue date is stored, so a lot is treated as short when
  its maturity is known and falls 0–366 days after that lot's acquisition (FIFO) or the
  episode entry (average cost). Unknown maturity is not treated as short. This can skip a
  long bond bought in its last year.
- **SBN, KSEI, IBPA and PHEI are Indonesian for income and for this discount only.** They
  do not make a sale an IDX share sale. The 0.1% stays `market === "IDX"` and
  `assetClass === "equity"`.

**A reinvested domestic dividend (attested):**

- UU PPh Art. 4(3)(f) / PMK 18/2021: a domestic dividend received by a resident individual
  is exempt from the 10% if it is reinvested in Indonesia for at least three tax years. The
  investment is due by the end of March of the following year (PMK 18/2021 Art. 36).
- Pocket cannot see the reinvestment, and it does not infer one from a later buy. A dividend
  can be attested with `transactions.idReinvested` (default false). When the row is a
  `domestic_dividend` and the flag is set, tax is zero, `exemption` is `reinvested`, the
  gross still counts as income, and the row leaves `taxToSelfPay`. Clearing the flag
  restores the 10%. The deadline is not stored.
- The flag does nothing for a foreign dividend, a coupon, or a fund distribution.

**Exemptions not modelled, stated as notes instead:**

- **Foreign dividends reinvested in Indonesia** can be exempt to the amount reinvested
  (PMK 18/2021). That reduction is not computed. Foreign income stays out of the estimate
  either way.

### The Rp7.5M bank-interest exemption (approximated)

**The rule, verified in the texts** (checked October 2026):

- PMK 212/PMK.03/2018 **Art. 7(a)**: the 20% final withholding of Art. 2(1) is not made on
  "bunga Deposito dan Tabungan serta Diskonto SBI, untuk jumlah Deposito dan Tabungan serta
  SBI yang tidak melebihi Rp7.500.000,00" — interest on deposits and savings whose amount
  does **not exceed** Rp7,500,000. So exactly Rp7,500,000 is exempt and Rp7,500,001 is not.
  (Article 7, letter a, is the right reference; Art. 5(1)(c) sets the 20% and Art. 4 brings
  current-account (giro) interest under the savings rules.)
- PMK 212/2018 **Art. 1(1)**: a "Deposito" is one "baik dalam mata uang Rupiah maupun dalam
  mata uang asing" — in rupiah or a foreign currency. A foreign-currency deposit at an
  Indonesian bank therefore counts toward the amount.
- PP 131/2000 **Art. 3(1)(a)** (the regulation PMK 212 implements; PP 123/2015 changed only
  the export-proceeds rates): the same Rp7,500,000 ceiling, with the condition that it is
  "bukan merupakan jumlah yang dipecah-pecah" — not an amount split up to stay under it. Its
  elucidation names the purpose: to protect small depositors and savers.
- PMK 212 **Art. 9** leaves the procedure of the exemption to a regulation of the Director
  General of Taxes; no such regulation saying how the amount is measured was found.

**Not in the primary texts.** That the amount is the customer's total at **one bank**, and
that it is judged **when the interest is paid or credited**, is how banks apply the rule and
how secondary sources describe it, but neither PMK 212 nor PP 131 says so in those words.
Neither says which rate converts a foreign-currency balance. Pocket follows that common
reading and uses the payment date's rate.

**How Pocket applies it.** For every Indonesian bank-interest payment (cash interest, no
paying instrument, classified `deposit_interest` — a portfolio with country `ID`, or IDR
interest with no country), `loadIdDepositFx` (`services/api/src/routes/transactions/tax-helpers.ts`)
and `computeIndonesianFinalTaxFromTradeLog` take the paying **portfolio's** cash balance
when the payment is credited and convert it to IDR:

1. `idCashBalancesBefore` (core): `cashBalances` — the same per-currency cash ledger the
   holdings and net-worth views derive — over the portfolio's other transactions executed at
   or before the payment. Rows at the payment's own instant count (a sum doesn't depend on
   their order; a date-only import books a same-day deposit at the same midnight), which errs
   toward the larger balance; the payment itself and later rows don't. Per portfolio this is
   one sorted walk over the ledger for all its payments (`idCashBalancesAtPayments`).
2. `idDepositBalanceIdr` (core): every non-zero currency converted to IDR at the payment
   date's rate and summed. `loadIdDepositFx` loads those rates once per account holder over
   all of their portfolios' payment dates (`getFxRatesForDates`, carried forward/back like the history
   routes; cached rates only for a read-scoped PAT).
3. `idDepositInterestExempt` (core): exempt when that total is between 0 and
   Rp7,500,000 inclusive. Zero counts as small: the balance is only known once explicit
   cash movements are recorded, and an account spent down to 0 (an RDN whose cash all went
   into a purchase) really holds nothing at the bank.

An exempt payment is taxed at 0: its row carries `exemption: "small_balance"` and
`rate: "0"`, it stays in `totalIncomeGross` and the by-year income, and adds nothing to
`estimatedTax`. Exempt and taxed payments of one source are separate rows (each row has one
rate); `incomeByCategory[].exemptGross` is the exempt part of a category. The Tax page labels
the row "Bank interest · exempt (balance ≤ Rp7.5M)". Securities income (bond coupons,
dividends, ETF and reksa dana distributions) is never affected.

**The approximation and its limits:**

- **One portfolio is treated as one bank.** Two portfolios at the same bank are judged
  separately (each may be under the ceiling when their sum is not), and one portfolio that
  mixes banks is judged as one. Pocket can't detect an amount split across banks or accounts
  (PP 131 Art. 3(1)(a)) either.
- **The balance must be knowable.** Before the portfolio's first explicit cash-account
  movement (deposit, withdrawal, loan leg or manual adjustment — `isCashAccountMovement`, the
  predicate `netWorthInputs` uses for `cashTracked`) the derived cash is only the sum of
  imported trades, so the balance is unknown and the full 20% applies. A negative total is a
  data gap (missing deposits), not a small balance: also 20%. A currency with no rate into IDR
  makes the total unknown too (20%, and the currency is reported in `fxMissingCurrencies`).
  Unlike net worth this does not depend on `cashCounted`: cash outside the performance
  boundary still sits at the bank and earns interest.
- **A recorded withholding wins.** When the transaction records tax withheld, that amount is
  the tax: the bank knew the customer's whole balance.
- An individual whose total annual income is at or below PTKP can also reclaim the tax
  (PMK 212 Art. 2(3)–(4)); Pocket doesn't model that.

### How a row is classified (`classifyIdIncome`)

"Domestic" is decided by the **paying instrument**, not the transaction currency: an
instrument is Indonesian when its market is `IDX`, `SBN`, `KSEI`, `IBPA` or `PHEI`, or its
ISIN starts with `ID`. `IDX` is also the market the 0.1% sales tax uses, and Indonesian
government retail bonds are often booked there. The other four venues are income and
bond-discount only — an instrument on them is not an IDX share sale. Currency would misfile
an Indonesian issuer paying in USD or a US stock paying in IDR, and the portfolio's country
(below) says where the account is held, not where a security was issued, so neither decides
an instrument's income. Then:

1. not Indonesian → `foreign`;
2. a `mutual_fund` or `etf` → `fund_distribution`;
3. a `coupon`, or any income on a `bond` → `bond_interest`;
4. a `dividend` → `domestic_dividend`;
5. other interest → `deposit_interest`.

A **floating-rate** retail bond (SBR/ST) is still a `bond`: its coupon rate resets every
three months, so the _amount_ of a projected coupon varies per period, but the classification
and the 10% rate above are unchanged. The rate schedule (`instruments.couponRateSchedule`)
only changes the magnitude of the projected income, never how it is taxed — see
[docs/data_providers.md](./data_providers.md#floating-rate-retail-bonds-sbrst).

**Cash interest** (no instrument) is decided by the **portfolio's country**
(`portfolios.country`, ISO 3166-1 alpha-2, set in the portfolio's settings; migration 0095) —
where the account is held, which is what PMK 212/2018 looks at:

| Portfolio country | Cash interest                                                         |
| ----------------- | --------------------------------------------------------------------- |
| `ID`              | `deposit_interest` (20% final) in **any** currency, a USD deposit too |
| any other country | `foreign` in any currency, IDR interest at a German bank too          |
| not set           | by currency: IDR → `deposit_interest`, anything else → `foreign`      |

The country is a user setting rather than a guess from the brokerage (free text) or the bank's
name, which were judged too unreliable. On `/networth/tax` each portfolio's interest is
classified with its own portfolio's country before the holder's portfolios are summed. An
instrument with no metadata row is treated as foreign rather than guessed.

**Three ways this mis-files a book.** Nothing below is a new category. `classifyIdIncome`
is unchanged; the row is taxed as whatever it was booked as.

1. **P2P / LPBBTI interest.** Cash `interest` on a portfolio with `country` `ID` (or unset,
   in IDR) is `deposit_interest`: 20% final, and the Rp7.5M test. Interest a company pays
   an individual through an OJK-registered lending platform is PPh 23 at 15% of the gross,
   withheld by the platform and credited in the annual return — not final, and not PPh 4(2)
   (PMK 69/PMK.03/2022 Art. 3(2)(a), 3(3)(a) and 3(4)). There is no loan-interest row, so
   this estimate cannot show that 15%. Do not book the receipt as cash `interest`. Book it
   as `bonus_cash`: that still counts as income for performance, and it is not in
   `TAXED_INCOME_TYPES`, so the row is left out of both tax tables rather than shown at 0%
   or at 20%. The 15% stays the platform's withholding, which Pocket does not compute.
2. **Stock dividend / bonus shares.** The shares are not cash income. The 0.1% applies only
   when they are sold. Booking the receipt as `dividend` charges 10% that is not due. The
   receipt is a `bonus` corporate action, recorded on the admin-gated Instrument event
   recorder (`POST /corporate-actions`) — the manual form no longer offers a `bonus`
   transaction. A `bonus` row that is already stored is not investment income either.
3. **Reksa dana, IDX ETF, or DIRE booked as `equity`.** The sale picks up the 0.1%, and a
   distribution booked as `dividend` picks up 10%. Class the instrument as `mutual_fund` or
   `etf` (there is no DIRE class): the distribution is `fund_distribution` at 0%, and the
   sale is not an IDX share sale.

A cash row carries `cashSource: { type, currency }` — its own currency, since every amount is
in the report currency — and is grouped per type and currency, so EUR and USD interest stay
two rows. Its `symbol` is a readable English label (`"Cash interest · EUR"`) for API and MCP
consumers; the web shows the translated label from `cashSource`.

### Recorded withholding

For the categories withheld at source (bond interest, bond discount and bank interest) a
withholding recorded on the transaction **is** the tax figure (`taxBasis: "recorded"`, or
`"mixed"` when only some of a row's transactions carry one); the statutory rate applies only
when none is recorded. That also covers coupons withheld at the old 15% before PP 91/2021.
A discount uses the sale-date rate instead (see above) when nothing was recorded. A domestic
dividend is always `gross × 10%`: nothing is withheld for a resident individual, so a
recorded tax there is not Indonesian tax. For foreign income the recorded withholding is
reported as `foreignTaxWithheld` (the creditable amount). Gross is always net received +
recorded withholding, converted to the report currency at the **payment date**'s rate.
A missing rate drops that row and names the currency (`fxMissingCurrencies`); it is never
counted 1:1.

### By year

`byYear` rolls up every year: the sales tax already decided for that year (recorded
withholding, or 0.1% of the gross sale value) plus each year's Indonesian income at its
category's rate (`income`), with foreign income in its own column (`foreignIncome`) and not
in `tax`. Coupons and the other income categories keep today's statutory rate (a coupon's
15% → 10% change of 2021 is not replayed unless the withholding is recorded); the amounts
themselves convert at the payment date, and a sale at the sale date. Bond discount
is the exception on the rate: its rate follows the sale date. Like the German table, it is an estimate.

Realized gain (`IdYearInput.realized` / `IdDisposalLot.gain`) is carried through the output
purely for display — it's informational, since ID final tax is never levied on gains.

### Where it is computed

`computeIndonesianFinalTaxFromTradeLog` (`services/api/src/routes/transactions/
tax-helpers.ts`) builds the inputs from the trade log and the raw transactions:
`/portfolios/:id/tax` per portfolio (base currency) and `/networth/tax` per holder (display
currency). The web consumes that payload (`indonesianFinalTax`) and never recomputes it; the
default all-portfolios view combines the holders with `mergeIndonesianFinalTax`. Both the
0.1% sales tax scope (`market === "IDX" && assetClass === "equity"`) and the income
classification apply to the per-row detail and the by-year rollup alike.

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

## Assistant explanations

The in-app assistant and MCP clients can explain the concepts above through the `explain_tax_concept`
tool (`packages/ai-tools/src/tax-concepts.ts`): static, reviewed text for Vorabpauschale,
Teilfreistellung, Basiszins, FSA, Sparerpauschbetrag and the loss pots. It cites no live rates and none of the
user's figures (those come from `get_tax_summary`), and for a user on the `"ID"` regime it carries a "German
regime only" caveat. **Keep that text in sync with this document** when the rules here change.

## References

- `packages/core/src/tax.ts` — German Sparerpauschbetrag/Teilfreistellung/two-pot
  netting/Vorabpauschale/harvest logic.
- `packages/core/src/tax-id.ts` — Indonesian final-tax logic.
- Indonesian sources (checked October 2026; the government JDIH sites were not reachable,
  so the PP texts are DDTC's reproductions):
  - PMK 212/PMK.03/2018 (deposit interest; Art. 1(1) foreign-currency deposits, Art. 5(1)(c)
    20%, Art. 7(a) the Rp7.5M exemption — read in the official text):
    https://www.pajak.go.id/sites/default/files/2019-06/212_PMK.03_2018Per.pdf
  - PP 131/2000 (Art. 3(1)(a) and its elucidation):
    https://perpajakan.ddtc.co.id/sumber-hukum/peraturan-pusat/peraturan-pemerintah-131-tahun-2000
  - Secondary, quoting Art. 7 PMK 212/2018 for the Rp7.5M rule:
    https://news.ddtc.co.id/berita/nasional/1809863/nabung-di-bank-dapat-bunga-terus-kena-pajak-begini-ketentuannya
    and https://ortax.org/pph-final-atas-bunga-deposito-dan-tabungan
  - PP 91/2021 (bond interest 10%, and Art. 2(3) the discount):
    https://perpajakan.ddtc.co.id/sumber-hukum/peraturan-pusat/peraturan-pemerintah-91-tahun-2021
  - Domestic dividends, reinvestment and self-payment (PMK 18/2021, PMK 81/2024):
    https://news.ddtc.co.id/berita/nasional/1817070/dividen-tak-diinvestasikan-sesuai-aturan-harus-setor-pph-ini-caranya
  - Foreign dividends: https://news.ddtc.co.id/berita/nasional/1802109/dividen-luar-negeri-juga-dikecualikan-dari-pph-begini-prosedurnya
  - PMK 69/PMK.03/2022 Art. 3 (P2P / LPBBTI interest: PPh 23 at 15% of gross, withheld by the
    OJK-registered platform, credited in the annual return, not final):
    https://www.pajak.go.id/id/artikel/kepastian-hukum-bagi-investor-p2p-lending
    and https://news.ddtc.co.id/berita/nasional/39093/potong-pajak-penghasilan-penyelenggara-p2p-lending-harus-tahu-ini
  - IDX sales tax reporting under PMK 81/2024:
    https://news.ddtc.co.id/berita/nasional/1807703/pmk-812024-perinci-ketentuan-bukti-potong-pph-atas-penjualan-saham
  - PMK 51/2025 and PMK 52/2025 (gold bars, from 1 Aug 2025: no PPh 22 on a consumer
    purchase; 0.25% when an end consumer sells bars to an LJK Bulion above Rp10,000,000):
    https://pajak.go.id/id/siaran-pers/pemerintah-tegaskan-konsumen-akhir-tak-dipungut-pajak-atas-pembelian-emas
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
