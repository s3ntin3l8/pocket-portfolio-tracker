# CLAUDE.md — Pocket (monorepo)

Personal portfolio tracker (English/Indonesian language support) that imports transactions
from **screenshots** (LLM vision), **CSV/PDF** (broker-specific parsers: DKB, IBKR, Trade
Republic, Coinbase), and direct broker sync (**Trade Republic** push-approval, **Interactive
Brokers** Flex token-pull), tracking **equities, gold, bonds, mutual funds (reksa dana), and
cash** with live IDX prices and a real-time gold ticker.

## Stack & topology

- **Monorepo:** npm workspaces + **Turborepo**. Node ≥26, ESM, TypeScript.
- **`services/api`** — **Fastify 5 + Drizzle (Postgres)**. The only thing that touches
  the DB; hosts auth, market-data jobs, screenshot/CSV/PDF import parsing, and broker
  sync (Trade Republic via vendored `pytr`, Interactive Brokers via Flex). Started from
  `s3ntin3l8/node-backend-template`. **Auth:** Authentik OIDC — `plugins/auth.ts`
  verifies Bearer JWTs (remote JWKS in prod, an injectable key in tests via
  `buildApp({ authKey })`), or a long-lived personal access token (`pt_`-prefixed,
  hashed at rest, `/me/tokens`, mutating methods blocked for read-scoped tokens, unless a route opts in with
  `config: { scope: "read" }` — a POST that is itself read-only, i.e. `/mcp`), or an **OAuth
  connector token** (claude.ai/mobile: a dedicated Authentik provider's own issuer + audience,
  `AUTHENTIK_MCP_AUDIENCE`; treated exactly like a PAT — read-only unless it carries
  `MCP_WRITE_SCOPE`, never admin, cannot mint tokens; `docs/mcp.md`);
  upserts the user by `sub`, and exposes the `app.authenticate` preHandler — every
  route scopes queries to `request.user`. **Routes** (`src/routes/*.ts`, one file per
  domain): `me` (profile + PATs), `account-holders`, `portfolios`, `transactions`
  (also holdings/trades/tax/income/allocation/forecasts/contributions — the largest
  route file), `corporate-actions`, `mergers`, `loans` (skip an installment / early payoff of a cicilan, `docs/loans.md`), `imports` (+`imports/parse`,
  `imports/confirm`), `documents`, `instruments`, `quotes`, `search`, `storage`,
  `targets`, `tr`, `ibkr`, `preferences`, `mcp` (read-only MCP endpoint, see `docs/mcp.md`),
  `assistant` (in-app chat over SSE, see `docs/assistant.md`), `admin`. Schema + migrations come from
  `@portfolio/db`; the API applies them at startup.
- **`apps/web`** — **Next.js (App Router) PWA**, Tailwind + shadcn/ui, **next-intl**
  (EN/ID). Talks to the API over HTTP (base URL is config-driven → Vercel-migratable).
  Includes an in-app assistant panel (`components/assistant/`, streams `POST /assistant/chat`; model
  output is untrusted — Markdown never renders images or raw HTML; see `docs/assistant.md`).
- **`packages/*`** — `schema` (zod + types), `core` (holdings, cost basis, XIRR/TWR,
  contributions, tax DE/ID, trade-log, allocation/rebalancing, forecasting, corp-actions,
  FX — the domain logic derived from transactions, the source of truth), `db` (Drizzle
  schema/migrations), `market-data` (provider abstraction: IDX, gold spot/Antam,
  EODHD/Yahoo/OpenFIGI), `api-client` (typed client for the PWA).
- **Infra:** Supabase Cloud (Postgres + Storage) to start; **Authentik** (OIDC) for
  auth; self-host on Proxmox is the exit path. Local dev via `docker-compose.yml`
  (Postgres + MinIO + optional Ollama, project `pocket-dev`) — deliberately a separate
  compose project from `docker-compose.prod.yml` (project `pocket-portfolio-tracker`,
  the deployed `api`+`web` stack, pull-only — both images come from GHCR rather than
  being built on the deploy host; `make prod-build` is the escape hatch for testing
  unmerged changes locally), so a bare `docker compose` in the repo root can never
  see or touch a live deployment. Always invoke the prod stack via `-f
docker-compose.prod.yml --env-file .env.prod` (or `make prod`/`prod-build`/`prod-down`/
  `prod-logs`/`prod-ps`) — never add a `name:` to either compose file without checking
  both together.

## Commands

Run from the repo root (Turborepo fans out across workspaces):

| Command             | Does                                               |
| ------------------- | -------------------------------------------------- |
| `npm install`       | Install all workspace deps (single root lockfile). |
| `npm run dev`       | Run all `dev` tasks (API watch + Next dev).        |
| `npm run build`     | Build every workspace.                             |
| `npm run lint`      | ESLint across workspaces.                          |
| `npm run typecheck` | `tsc --noEmit` across workspaces.                  |
| `npm test`          | Vitest across workspaces.                          |
| `npm run format`    | Prettier write.                                    |

Target one workspace with `--workspace @portfolio/<name>` (e.g.
`npm run dev --workspace @portfolio/api`). DB: `npm run db:generate --workspace
@portfolio/db` after editing the schema (`packages/db/src/schema/*.ts`); `npm run
db:seed --workspace @portfolio/api` to seed.

**Dev via `make`** (wraps the npm scripts above, plus dev-only setup): `cp .env.example
.env` defaults `DATABASE_URL` to embedded PGlite and `STORAGE_PROVIDER` to local-folder
storage — no Docker, no Authentik (`DEV_AUTH_TOKEN` bypasses login). `make dev-setup`
(symlinks `.env` into `apps/web/`, then seeds the demo dataset) once, then `make dev`.
`make dev-reset` wipes the PGlite dev DB + local storage; `make seed-demo` refuses to run
against a non-`pglite://` `DATABASE_URL` unless `FORCE=1` (it deletes/reinserts rows by
email plus global instrument rows by symbol). `make services` starts real local Postgres +
MinIO instead, for Postgres-parity dev. To exercise local email/password auth instead of
the `DEV_AUTH_TOKEN` bypass: set `AUTH_LOCAL_SECRET`, comment out `DEV_AUTH_TOKEN`, then
either `make seed-demo-login SEED_DEMO_PASSWORD=changeme` or just visit `/` — with zero
users in the database it shows a first-run "create your admin account" form
(`POST /auth/local/setup`, closes itself once any user exists). See README's
"Self-hosting without Authentik" for the self-host-focused version of this.

> **Known dev flake:** on `npm run dev` the API (`tsx watch`) can crash once at
> startup with `SyntaxError: … does not provide an export named …` from a
> `@portfolio/*` dist file. This is a benign race: `tsc --watch` is mid-emitting
> `dist/` when `tsx` first loads the module graph. It self-recovers on `tsc`'s next
> emit (usually within a few seconds). If the API stays unreachable, check for a
> stale `tsx watch` process holding the port before re-running.

> **Known console warning:** Next.js logs `Encountered a script tag while rendering
React component` from `ThemeProvider`. This is an upstream bug in `next-themes`
> (issue #387) caused by its inline FOUC-prevention `<script>` conflicting with React
> 19's new script-handling rules. Cosmetic only — themes work correctly. Track
> [pacocoursey/next-themes#387](https://github.com/pacocoursey/next-themes/issues/387)
> for a fix.

## Conventions

- **ESM throughout** (`"type": "module"`); `.ts` sources import with `.js` specifiers
  (NodeNext resolution). Prefer `import type` (ESLint-enforced).
- **Money is never a float** — use Postgres `numeric`/decimal; every amount carries an
  explicit currency.
- **Transactions are the source of truth.** Holdings, P&L, cash balance, XIRR and net
  worth are derived in `packages/core` — never stored as primary state.
- **One boundary per portfolio (contributions & performance).** Each portfolio declares
  whether cash is _inside_ its investment boundary (savings/deposit accounts — Tagesgeld,
  Festgeld, a child's savings depot) or _outside_ it (mixed/checking, invest-only) via the
  `cashCounted` flag. **Contribution = net external cash crossing that boundary; the
  performance value = what's inside it — same boundary for numerator and denominator,
  always.** Cash-inside: contribution = deposits − withdrawals, value = net worth incl. cash.
  Cash-outside: contribution = net invested capital (kind-aware buys − sells), value =
  securities only, cash excluded from net worth. Never mix boundaries (cash in the value but
  not the contribution, or vice versa) — that manufactures phantom gains. Income (dividends/
  interest/coupons, `saveback`, bonus shares) is return, never contribution; `transfer_in` is
  contributed capital at its carried cost basis. Lives in `packages/core/src/contributions.ts`'s
  `walkInsideDays`/`walkOutsideDays` (the shared boundary walk) + `summarizePortfolio`.
  `boundaryFlowPoints` (that walk's per-transaction projection) and `transferFlowPoints` (just
  its transfer-sourced points) are exported for XIRR-style consumers — see the next bullet.
  The walks' average-cost pool is split-aware: pass the valuation's `corporateActions` to
  `contributionStats`/`boundaryFlowPoints`/`transferFlowPoints`/`boundaryFlows` (#823). The
  value side's cash/liabilities half is `netWorthInputs` (`packages/core/src/valuation.ts`) —
  the live valuation and the backfill both write `portfolio_snapshots` through it; never
  re-derive cash or loans inline (#820). Period P&L (`periodReturn`) nets out each portfolio's
  own boundary flows after its own opening snapshot (#824).
- **`transfer_in` / `transfer_out` are first-class transaction types** (since PR #309,
  migration 0044). Depot-to-depot share transfers (Depotübertrag): cash-neutral, shares move
  at carried cost basis — no P&L on `transfer_out` (not a disposal). This replaces the legacy
  `bonus`+`kind:"transfer_in"` sub-type pattern (those rows should be migrated). Inside-boundary:
  `transfer_in` is an inflow at carried cost, `transfer_out` an outflow at carried cost — the
  running average cost of the shares leaving (same pool as the outside walk), never the row's own
  price, which broker feeds set to 0 —
  `boundaryFlowPoints(txns, "inside", …)` is the complete, correct flow list for XIRR here, since
  cost-basis and cash-received valuation coincide for deposit/withdrawal/transfer_in/transfer_out.
  Outside-boundary: `transfer_in` at gross cost, `transfer_out` at running average cost — but
  `boundaryFlowPoints(txns, "outside", …)` values a `sell` at cost-of-sold and excludes dividends
  entirely (contribution tracking, not cash flow), so an XIRR-style consumer must NOT delegate to
  it wholesale there; compose non-transfer rows via `cashFlow()` (proceeds, income included) with
  `transferFlowPoints(txns, "outside", …)` for the transfer rows instead — see
  `services/api/src/routes/transactions/shared/flows.ts`. Getting this distinction wrong is
  exactly how #736 (transfers valued at ≈0) happened, and re-collapsing the two is how a second,
  different bug (dropping realized gains/dividends from `totalReturnPct`) would happen next.
  **The TWR securities sleeve is a third, separate definition:** `buildDailyValueFlows`
  (`packages/core/src/twr.ts`) and the daily snapshot job (`services/api/src/services/snapshots.ts`)
  book a transfer as an `effectiveFlow` equal to the market value it adds/removes that day
  (`transferValueFlow` — carried cost only when that path values the holding at cost), so the
  transfer day is return-neutral (#815). Don't reuse `transferFlowPoints` there, and don't move
  market-value transfer valuation into the contribution/XIRR walk. `buildDailyValueFlows` walks holdings
  incrementally via `createHoldingsCursor` (`packages/core/src/holdings.ts`, #896) instead of
  replaying `computeHoldings` per day; the cursor shares `computeHoldings`' per-event fold and
  must stay output-identical to it (rows, order, strings) — `test/holdings-cursor.test.ts` is the
  parity guard, so change the fold in one place only. Instruments on either side of a merger
  always take the full-replay path for the transfer "without this row" valuation. **Cost basis on import:** a
  broker feed without the carried basis (TR always; IBKR without `costBasisPrice`/`costBasisMoney`
  — `positionAmount` is market value and is never booked as cost) emits the `transfer_in` draft
  at price 0 with `attention: ["needs_cost_basis"]`; both confirm paths
  (`/imports/:id/confirm`, `…/transactions/resolve-drafts`) refuse a price-0 `transfer_in` with 400
  `transfer_cost_basis_required` until the user enters it (#818).
- **A missing FX rate is never 1:1 and never a failed request — it is a flagged exclusion.**
  `getFxRates`/`getFxRatesForDates` carry the latest cached rate forward (`getFxRates` only within
  `FX_MAX_CARRY_FORWARD_DAYS` = 14, `packages/core/src/sanity-gates.ts` — an older rate counts as
  missing, never shown as today's); if a currency still has none, `makeFxRateFn` returns `null` and records the currency in a request-scoped set
  (`services/api/src/lib/fx-missing.ts`, opened per request in `app.ts`). Every consumer excludes
  what it can't convert — `summarizePortfolio` flags holdings `fxMissing` (display values null,
  out of every total; unlike `valuedAtCost` there is no sane number) and lists
  `fxMissingCurrencies`; per-transaction consumers use `partitionConvertible` (drops whole
  instruments, so no cost basis is split), pure sums `excludeMissingFx`, row/series consumers
  `fxAvailable`/`tryConvert` — and the response is a 200 carrying `fxMissingCurrencies` (top-level
  on object responses, plus the `x-fx-missing-currencies` header on every shape; cached
  derivations replay it). The web shows `FxMissingBanner` when it's non-empty. The daily/intraday
  snapshot jobs and the backfill skip a portfolio rather than persist a partial value (#816).
  `convert()` still throws `FxRateMissingError` as a last resort — reaching it is a bug (logged).
  Never add a `?? "1"` fallback.
- **A holding with no usable market price is valued at cost basis, not skipped/zero.**
  Nothing economic happened on the day a price feed goes silent, so treating it as worth 0
  understates net worth by the whole cost basis, not by the (unknown) gain/loss since purchase.
  Applies in `summarizePortfolio`/`netWorth` (`packages/core`) and in the historical backfill's
  day-by-day reconstruction (`buildDailyValueFlows`, `services/api/src/services/backfill/core.ts`)
  — `HoldingValuation.valuedAtCost` / `PortfolioSummary.holdings[].valuedAtCost` flags it for the
  UI to disclose. The historical path additionally distinguishes "never priced at all" (cost
  fallback) from "priced before, but this particular gap exceeds the carry-forward window"
  (stays excluded, unchanged) via an explicit `hasEverPriced` callback — collapsing that
  distinction would make a genuinely-priced holding with an ordinary data gap bounce to cost and
  back on every reveal, corrupting the TWR index with a fake single-day return. The live/daily
  valuation path (`services/api/src/services/valuation.ts`, feeding `recordDailySnapshots`) makes
  no such distinction — any miss there always falls back to cost, so a feed recovering after a
  stale gap DOES still bounce that one day's snapshot from cost to market value. This is a
  smaller, accepted artifact (cost is a much closer approximation than the pre-#744 zero), not a
  claim that the live path is immune to bouncing — `portfolio_snapshots` is itself a series the
  history chart reads, same as the backfill's. Replicating `hasEverPriced`'s full gap-vs-never
  distinction there was judged not worth the complexity for a single day's number; revisit if it
  proves visibly wrong in practice. Both paths share one staleness threshold,
  `MAX_PRICE_CARRY_FORWARD_DAYS` (`packages/core/src/sanity-gates.ts`) — they used to disagree
  (7 vs. 10 days) before issue #744 unified them. The same threshold also gates _live_ provider
  quotes by their own `asOf` (`isStaleQuote`, `services/api/src/services/price-cache.ts`, used
  by `getCachedQuotes` and `refreshHeldPrices`): an older quote counts as a miss and is not
  cached, so a dead feed drops to the cost path instead of being marked to its last price
  forever (audit B13).
- **Every gain figure names its basis.** `GainSummary` (`packages/core/src/gain-summary.ts`,
  on `/networth` and `/portfolios/:id/summary` as `gain`) is the one derivation of
  `{ value, costOfOpen, netContributed, unrealized, realized, income }` — built from
  `summarizePortfolio` + `contributionStats` on the same instruments and boundary, no new walk.
  In the web every gain number renders through `GainFigure` with a basis label ("vs cost of
  holdings" for unrealized-over-open-cost: Holdings rail, sidebar; "vs net contributed" for
  value-over-contributions: Savings, Reports › Savings), and the two headline figures open the
  same `GainExplainer` dialog. A row valued at cost or without an FX rate has no measured gain:
  its P&L cells render "—" (neutral), never a green "+0.00". Headline net worth is formatted
  by `formatNetWorth` everywhere (hero, rail, sidebar) so no surface rounds differently.
- **The URL is the view state (web).** Scope is `?scope=all|p:<id>|h:<id>`: the proxy
  (`apps/web/src/proxy.ts`) copies a valid value into the `x-pocket-scope` request header and
  `getRawScope` (`lib/server-api/_shared.ts`) prefers it over the `pf` cookie (default for
  scope-less URLs, still written by the switcher). Internal links that should keep scope use
  `ScopeLink`/`withScope`. The hero chart range (`?range=`) and the Income year filter
  (`?year=`) are shallow `history.replaceState` writes (`lib/url-state.ts`); the Tax year
  (`PeriodSelect`) is a `router.replace`. Scope changes `router.push`; range/period never add
  history entries. The URL is the source of truth; the `pf` cookie is the fallback for
  scope-less URLs only (written on a switcher click, not on a deep link). The `(app)` layout (sidebar net worth, switcher props) is not re-rendered by a
  search-param navigation or by back/forward across scopes, so `ScopeSync` (in `AppShell`) compares the URL's
  effective scope with the scope the layout rendered for (`serverScope`) and `router.refresh()`es on a
  mismatch. Ids only in params — never personal data.
- **Estimated Vorabpauschale is derived, never stored.** For DE-regime funds with no
  broker-booked `vorabpauschale` row for a completed year, `estimateVorabRows`
  (`packages/core/src/tax/vorab-estimate.ts`, loaded by `services/vorab-estimate.ts`) adds
  `estimated: true` accrual rows to every DE-regime trade log (Tax, Trades, Sparplan; boundary
  prices batched once per request via `loadVorabPrices`); a broker row for the same
  (instrument, year) always wins, and a missing price/Basiszins means no row (never 0). The
  §18 Abs. 2 monthly reduction applies to the Vorabpauschale itself, after cap and
  distributions. See `docs/tax.md`.
- **Freistellungsauftrag (FSA) has two levels, don't conflate them.** The legal
  per-person cap lives on `accountHolders.taxAllowanceAnnual` (Sparerpauschbetrag, default
  €1,000/€2,000 jointly assessed). The actual FSA is _allocated_ per depot via
  `portfolios.taxAllowanceAnnual` — same-holder portfolios should sum to ≤ the holder's
  cap, but this is only checked and surfaced as an over-allocation warning (`tax.ts`), not
  a hard DB constraint. Feeds `trade-log.ts`'s `vorabByYear`/`vorabCredit` and `tax.ts`'s
  Teilfreistellung netting.
- **`userPreferences` holds two global tax switches**: `taxRegime` (default `"DE"`, the
  other value routes to the Indonesian final-tax module) and `costBasisMode` (default
  `"purchase_price"`). Changing either changes which `packages/core` tax module and
  cost-basis convention every portfolio's numbers are computed with — check both before
  assuming DE-style realization-based tax logic applies. Server-side, `costBasisMode` is
  resolved by `resolveCostBasisMode` (`?costBasis=` query wins, else the saved preference) —
  never read `?costBasis=` alone. Loss netting is one-way (`computePotsUsage`): general-pot
  losses offset stock gains, stock losses only offset stock gains; the default capital-gains
  rate is 26.375% (`effectiveCapitalGainsTaxRate`); see `docs/tax.md`.
- **A gate decides only on a successful answer.** Anything that 404s/redirects on `me`
  (the admin layout and pages) goes through `requireAdmin()` (`apps/web/src/lib/server-api/user.ts`):
  only a successful non-admin answer is `notFound()`; a failed lookup (429/401/5xx) renders
  `<AdminGateFailure>` (DataState + retry), never "Page not found". Non-gating uses (nav item,
  settings row) may hide on failure via `loadMe()`.
- **Response contracts live in `@portfolio/schema`** (`packages/schema/src/schema/responses.ts`):
  `/networth`, `/portfolios/:id/summary` and both paginated transaction lists. They mirror what
  the routes actually serialize (loose objects; money is a decimal string that may carry Decimal.js
  exponent form). `createApiClient({ validateResponses })` checks those four responses and throws
  `ApiError` (502, body `invalid_response: <path> — <issues>`) on drift; the web turns it on outside
  production. API route tests `parse` real responses against the same schemas, and
  `packages/api-client/src/response-contract.type-test.ts` fails `tsc` if a schema stops being
  assignable to the client interface. Change a serializer → change the schema in the same PR.
- **Imports never auto-commit.** Screenshot/CSV parses become _draft_ records that the
  user confirms before a transaction is written. Dedup runs at three levels: **file-level**
  (same file re-upload → `contentHash`), **within-source transaction-level** (the
  `(portfolioId, source, externalId)` unique index + `onConflictDoNothing`), and
  **cross-source economic** (a source-independent `(instrument, type, day, qty, price)`
  fingerprint flags likely CSV-vs-PDF re-imports in the review screen, count-aware so
  genuine same-day repeats aren't suppressed). Raw screenshots are deleted after a
  confirmed parse (parsed JSON is kept).
  AI-assisted entry (`propose_transactions` → `POST /imports/propose`) follows the same rule:
  it only ever creates a draft import (parser `ai`, booked as `source="manual"` — never a
  document, so it can be flagged a duplicate of another source but never enrich it). Write
  tools are offered only to write-scoped credentials (`createTools(client, { write })`).
- **Tests** live in each workspace's `test/`. The API uses an embedded **PGlite**
  Postgres (`pglite://` URLs) so tests need no external DB; `app.inject()` for routes.
- Config is read from `app.config` (typed in `services/api/src/plugins/env.ts`), not
  `process.env` directly. After editing the Drizzle schema (`packages/db/src/schema/*.ts`),
  run `npm run db:generate --workspace @portfolio/db` and commit the migration under
  `packages/db/drizzle/`.
- **Logging:** pino to stdout by default. Set `LOG_DIR` (see `.env.example`) to also fan
  out to a `pino-roll` rotating file (daily rotation, 20 MB cap, 14-day retention) —
  `resolveLogDestination()` in `services/api/src/app.ts`. Same secret redaction (auth
  headers, cookies, TR phone/pin, `DB_ENCRYPTION_KEY`, …) applies to both sinks. Leave
  unset for Docker/prod setups that already capture stdout via journald/CloudWatch; both
  `docker-compose.yml`'s (profile `full`) and `docker-compose.prod.yml`'s `api` service
  pass `LOG_DIR` through opt-in (unset by default) and mount their own project-scoped
  `apilogs` volume for it.
- **Conventional Commits** (Release Please cuts versions). `detect-secrets` runs in
  pre-commit/CI against `.secrets.baseline`.
- **PR descriptions (and commit messages) stay generic.** No personal/account-holder
  names and no private account specifics (depot/account numbers, exact balances); keep
  them concise and high-level — describe the change and the class of problem, not the
  individual account that surfaced it.
- **Before committing:**
  `npm run lint && npm run typecheck && npm test && npm run format:check`.
- **Issues and PRs use the repo templates**
  (`.github/ISSUE_TEMPLATE/issue-blueprint.md`, `.github/pull_request_template.md`) — fill
  them in rather than skipping them. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full
  pre-PR checklist.

## Testing & coverage

- **Runner:** Vitest. The root `vitest.config.ts` aggregates every workspace via
  `test.projects`; `npm test` / `npm run test:coverage` run them together and merge
  coverage into `./coverage`.
- **Coverage gate: 70%** (lines/functions/branches/statements) enforced two ways — the
  root Vitest `thresholds` (fails `test:coverage` locally) and `coverage-fail-under: 70`
  in CI. **Keep it green: new code lands with tests.** Excluded from the gate:
  entrypoints/CLIs (`server.ts`, `db/seed.ts`) and framework boilerplate
  (`app/**`, `proxy.ts`, `i18n/**`, configs, `*.d.ts`).
- **API/packages:** Node env. The API uses embedded **PGlite** (`pglite://` URLs) so
  tests need no external Postgres; routes use `app.inject()`.
- **Web e2e (local only, not in CI):** Playwright specs in `apps/web/e2e/`, run with `npm run e2e
--workspace @portfolio/web` (boots PGlite + demo seed + `next dev` on ports 3101/3105, see
  CONTRIBUTING.md). Excluded from Vitest; `turbo test` never runs it.
- **Python (pytr):** the vendored Trade Republic entrypoints in `services/api/python`
  have **pytest** unit tests (`test_tr_export.py`) for the detail-extraction heuristics —
  the part not exercised by the Node mapper tests. Run with `npm run test:py --workspace
@portfolio/api` (uses `.venv-pytr`) or `python -m pytest services/api/python`; CI runs
  them in the `test-python` job. Outside the Vitest coverage gate.
- **Web:** **jsdom + React Testing Library** (`@vitejs/plugin-react`). Render client
  components inside `NextIntlClientProvider` with `messages/en.json`. Server components
  / pages are excluded from coverage (cover via e2e later).
- **Note:** Vitest 4 bundles Vite 8, so the root `package.json` pins
  `overrides.vite: ^8` to dedupe Vite (otherwise `plugin-react` binds the wrong copy
  and JSX fails to transform).

## CI/CD

`.github/workflows/` are thin callers of the reusable workflows in
[`s3ntin3l8/.github`](https://github.com/s3ntin3l8/.github): `ci-cd.yml` runs
**ci-node** at the root (so root scripts fan out via Turbo: lint, typecheck, build)
plus a self-contained **test-python** job (pytest over `services/api/python`, the
vendored pytr extraction tests — not covered by ci-node), then two parallel
**docker-publish** jobs (root `Dockerfile` → `@portfolio/api`, and `apps/web/Dockerfile`
→ `@portfolio/web`) once both test jobs pass. `release-please.yml` mirrors the same
two-image publish on releases. Tests run
**sharded 4-way** (`test-shards: "4"`) via `test:coverage:sharded` — the same Vitest
coverage run as `test:coverage`, but with `coverage.thresholds` disabled per-shard
(a single shard's inherently-partial coverage would otherwise trip the 70% gate); the
merged coverage across all 4 shards is what's actually checked against
`coverage-fail-under`, in a `test-merge` job that runs after the shard matrix. Turbo's
build/lint/typecheck cache is also persisted across runs (`turbo-cache: true`).
Sharding + caching cut the job from ~5m30s to ~2m (live-validated via a smoke-test PR
before adopting).
Caller jobs invoking reusable workflows with write scopes **must declare a
`permissions:` block** or the run fails at startup. `codeql`, `dependency-review`,
`release-please`, `cleanup-ghcr` are also wired.

`codeql` and `dependency-review` are gated on `github.event.repository.private == false`
— they need GitHub Advanced Security, which is free on public repos but not private ones.
The repo **is public** (confirmed 2026-07-16), so both are live on every PR, not
conditionally skipped.

Two more workflows are mention-triggered, not push/PR-triggered: **`claude.yml`** runs
Claude Code itself against `@claude`-mentioned issues/PR comments/reviews; **`hermes.yml`**
runs an on-demand PR review bot on `@s3ntin3l8-hermes` comment mentions (guarded against
re-triggering itself via `github.actor`, since a submitted review's body also matches the
mention substring — see the in-file comment on the Claude→Hermes cascade, `.github#527`).
`claude.yml` is a thin caller of the reusable `s3ntin3l8/.github/.github/workflows/claude-code.yml`
(same `workflow_call` pattern as `hermes.yml`/`hermes-review.yml`) — the trusted-commenter
gate, Node setup, and review-capable tool grants (including
`mcp__github_inline_comment__create_inline_comment` for inline suggested edits, plus
`gh pr review` for a formal Approve/Request-Changes verdict) live there once, shared with
`runway-ai-usage-tracker` and `claude-remote-session` (`.github#34`).
