---
name: pocket
description: >-
  Pocket's non-obvious correctness invariants: the changes that look reasonable on their own but
  break something another part of this repo relies on (cash boundary, the three separate
  transfer valuations, missing FX and missing prices, derived-never-stored figures, tax
  switches, import drafts, auth scopes, response contracts, URL view state). Read it before you
  write or change code in packages/core, services/api or apps/web, before you plan a feature
  that touches money, performance, tax or imports, and when you review a diff in this repo.
---
<!-- mullion:scaffold:pocket -->

# Pocket invariants

Each item is a rule, the code shape that breaks it, and where the rule lives. The long form is
in AGENTS.md › Conventions and `docs/` (`tax.md`, `integrity.md`, `mcp.md`, `assistant.md`,
`loans.md`). When this file and the code disagree, trust the code and fix this file.

## Money and derivation

- **Money is a decimal string or `Decimal`, never a JS `number`**, and every amount has a
  currency next to it. Look for `parseFloat`/`Number(`/`+amount`/`toFixed` on amounts, and new
  DB money columns that aren't `numeric`. Serialized money can be in Decimal.js exponent form
  (`1e-7`), so don't regex-parse it.
- **Transactions are the only primary state.** Holdings, P&L, cash balance, XIRR and net worth
  are derived in `packages/core`. A new column that stores a balance, position or estimate is
  a red flag. The same goes for estimated Vorabpauschale: `estimateVorabRows` adds
  `estimated: true` rows on read. A broker row for the same (instrument, year) wins only if it
  carries a `vorabBase`. A missing price or Basiszins means no row, never a 0 row.
- **Cash and liabilities on the value side go through `netWorthInputs`**
  (`packages/core/src/valuation.ts`). The live valuation and the backfill both write
  `portfolio_snapshots` through it. Computing cash or loans inline in a route or job is the
  #820 bug.

## The cash boundary (`cashCounted`)

- Contribution and performance value must use **the same boundary**:
  - Cash inside: contribution = deposits − withdrawals, value = net worth including cash.
  - Cash outside: contribution = net invested capital, value = securities only.
- A diff that puts cash in the value but not in the contribution (or the reverse) creates
  phantom gains. The shared walk is `walkInsideDays`/`walkOutsideDays` in
  `packages/core/src/contributions.ts`.
- Income (dividends, interest, coupons, `saveback`, bonus shares) is **return, never
  contribution**.
- `contributionStats`, `boundaryFlowPoints`, `transferFlowPoints` and `boundaryFlows` need the
  valuation's `corporateActions`, because the average-cost pool is split-aware (#823).
  Dropping that argument is a bug.
- `periodReturn` nets out each portfolio's own boundary flows after that portfolio's own
  opening snapshot (#824). Don't net them at the aggregate level.

## Transfers: three valuations, never interchangeable

`transfer_in`/`transfer_out` are cash-neutral. `transfer_out` is not a disposal, so it has no
P&L.

1. **Contribution and inside-boundary XIRR:** use carried cost. `transfer_out` is valued at the
   running average cost of the shares leaving, **never the row's own price**, which broker
   feeds set to 0. For "inside", `boundaryFlowPoints(txns, "inside", …)` is the complete XIRR
   flow list.
2. **Outside-boundary XIRR:** do **not** use `boundaryFlowPoints(…, "outside")` wholesale. It
   values a sell at cost-of-sold and drops dividends. Compose `cashFlow()` for the non-transfer
   rows with `transferFlowPoints(txns, "outside", …)` for the transfer rows, as
   `services/api/src/routes/transactions/shared/flows.ts` does. Collapsing the two brings back
   #736, or drops realized gains and dividends from `totalReturnPct`.
3. **TWR / daily snapshots:** `transferValueFlow` (`packages/core/src/twr.ts`) books the
   **market value** the transfer adds or removes, so the transfer day is return-neutral (#815).
   Don't reuse `transferFlowPoints` here, and don't move market-value transfer valuation into
   the contribution or XIRR walk.

Import side: a feed without carried basis (TR always; IBKR without
`costBasisPrice`/`costBasisMoney`) emits `transfer_in` at price 0 with
`attention: ["needs_cost_basis"]`. IBKR's `positionAmount` is market value; never book it as
cost. Both confirm paths (`/imports/:id/confirm` and `…/transactions/resolve-drafts`) must keep
refusing a price-0 `transfer_in` with 400 `transfer_cost_basis_required` (#818).

## FX: a missing rate is a flagged exclusion

- **Never `?? "1"`**, never 1:1, and never a failed request.
  - `makeFxRateFn` returns `null` and records the currency in the request-scoped set
    (`services/api/src/lib/fx-missing.ts`).
  - The response is a 200 with `fxMissingCurrencies`: top-level on object responses, plus the
    `x-fx-missing-currencies` header on every shape.
  - Reaching `convert()`'s `FxRateMissingError` is a bug.
- **Exclude with the helper that fits, so cost basis is never split:**
  - `summarizePortfolio` flags the holding `fxMissing` (display values null, out of totals).
  - Per-transaction consumers use `partitionConvertible`, which drops whole instruments.
  - Pure sums use `excludeMissingFx`; row and series consumers use `fxAvailable`/`tryConvert`.
  - XIRR uses `excludeFxMissingInstruments`.
- Snapshot jobs and the backfill **skip the portfolio** rather than persist a partial value. The
  one exception: the backfill drops price rows whose currency appears only on prices (#1179).
- **The FX date follows the paired value.** The all-time XIRR (`/networth`) converts every flow
  at today's rate. The per-year XIRR (`/insights`) converts each flow at its own date
  (`boundaryFlows(…, "flowDate")`, #1020).
- `getFxRates` carries a rate forward at most `FX_MAX_CARRY_FORWARD_DAYS` (14). An older rate
  counts as missing.
- **Read-scoped PAT requests are cached-only:** no provider fetch, no `fx_rates` write.
  `defaultFxProvider()` is `null` inside such a request. New FX loaders must default to it, not
  to `getFxProvider()`. Cached derivations for that request are keyed `:ro` (via
  `withDerivationCache`/`derivationCacheKey`); never let them share a key with a session's
  result.

## Missing prices: value at cost, never zero

- No usable price → value the holding at cost basis with `valuedAtCost`, not 0 and not skipped.
  On a row merged across depots, `valuedAtCost` means every depot is at cost. A mix is
  `valuedAtCostPartial` (#1193).
- The **historical** path (`buildDailyValueFlows`, `services/api/src/services/backfill/core.ts`)
  must keep the `hasEverPriced` distinction:
  - Never priced → cost.
  - Priced before, but this gap exceeds the window → stays excluded.
  - Collapsing the two injects fake one-day returns into TWR. The live path deliberately
    doesn't make this distinction.
- One staleness threshold for everything, `MAX_PRICE_CARRY_FORWARD_DAYS`
  (`packages/core/src/sanity-gates.ts`), also used for live quotes via `isStaleQuote`. A
  second, local constant is the pre-#744 bug.
- `createHoldingsCursor` must stay output-identical to `computeHoldings` (rows, order,
  strings). Change the per-event fold in one place; `test/holdings-cursor.test.ts` is the
  parity guard. Merger instruments take the full-replay path.

## Gains, tax, preferences

- Every gain figure names its basis (`GainSummary`; in the web, `GainFigure` with "vs cost of
  holdings" / "vs net contributed").
  - A `valuedAtCost` or `fxMissing` row renders "—", never a green "+0.00".
  - Headline net worth always goes through `formatNetWorth`.
- `costBasisMode` is resolved via `resolveCostBasisMode` (the query parameter wins, else the
  saved preference). Reading `?costBasis=` alone is a bug.
- `taxRegime` switches between the DE and ID tax modules, so never assume DE realization logic.
- FSA has **two levels**:
  - `accountHolders.taxAllowanceAnnual` is the legal per-person cap.
  - `portfolios.taxAllowanceAnnual` is the per-depot allocation of that cap.
  - Over-allocation is a warning (`tax.ts`), not a constraint. Don't swap the two levels.
- Loss netting is one-way (`computePotsUsage`): general-pot losses offset stock gains, but
  stock losses only offset stock gains.
- Messages: `Tax.distribution.capDesc` contains invisible U+00AD soft hyphens. Keep them when
  you rewrite the message.

## API contracts, auth, imports

- **Change a serializer → change `packages/schema/src/schema/responses.ts` in the same PR.**
  This covers `/networth`, `/portfolios/:id/summary` and both paginated transaction lists. The
  web validates against them outside production and turns drift into a 502.
- Every route scopes queries to `request.user`. Taking an id from params or body without an
  owner filter is a cross-account leak.
- PATs and OAuth connector tokens are read-only unless they have write scope. They are never
  admin and cannot mint tokens. `config: { scope: "read" }` is only for a POST that really is
  read-only, such as `/mcp`.
- **Imports never auto-commit.** Every parse (screenshot, CSV, PDF, broker sync, AI
  `POST /imports/propose`) ends as a draft the user confirms. AI drafts are
  `source="manual"`, never a document.
- Dedup stays at exactly three levels:
  - `contentHash`.
  - The `(portfolioId, source, externalId)` unique index with `onConflictDoNothing`.
  - The count-aware cross-source `(instrument, type, day, qty, price)` fingerprint.
- AI write tools are only offered to write-scoped credentials (`createTools(client, { write })`).
- Assistant model output is untrusted: its Markdown never renders images or raw HTML.

## Web

- **The URL is the view state.**
  - Scope is `?scope=all|p:<id>|h:<id>` (header first, then the `pf` cookie, for scope-less
    URLs only). Internal links keep scope through `ScopeLink`/`withScope`.
  - `?range=` and `?year=` are shallow `replaceState` writes; never add history entries for
    range or period.
  - Only ids go in params, never personal data.
- Admin gates go through `requireAdmin()`. Only a *successful* non-admin answer gives
  `notFound()`; a failed lookup renders `<AdminGateFailure>`.
- Task-tier overlays use `DialogContent`'s `size` scale, and their only breakpoint is `md`.
  Never branch the overlay *component tree* on `useMediaQuery`/`isDesktop`: crossing the
  breakpoint remounts it and drops user input. Use CSS (`max-md:`/`md:`) on one tree.
- A UI change isn't done until you've looked at it with `make visual-check ROUTES=…`. A new
  route or state needs a scene in `visual/scenes.json`.

## Plumbing

- ESM: `.ts` sources import siblings with `.js` specifiers, and type-only imports use
  `import type`.
- Config comes from `app.config` (`services/api/src/plugins/env.ts`), never `process.env`.
- A schema edit in `packages/db/src/schema/*.ts` needs
  `npm run db:generate --workspace @portfolio/db`, with the migration committed under
  `packages/db/drizzle/`.
- A new derived figure gets a hand-derived golden ledger in `services/api/test/integrity/`.
  Never paste expected values from a run.
- Compose: never add `name:` to any compose file (including the override). Dev (`pocket-dev`)
  and prod (`pocket-portfolio-tracker`) are separated by project name on purpose.
