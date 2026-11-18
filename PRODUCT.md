# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: one household managing its real money.** Adults with assets in Germany and
  Indonesia, holding depots at several brokers, plus joint and children's accounts
  (account holders, per-depot Freistellungsauftrag). They check net worth and performance
  regularly, import new activity from their brokers, and prepare yearly tax figures.
- **Secondary: self-hosting investors.** Privacy-minded people who run Pocket on their own
  server for their own household, typically with German and/or Indonesian brokers. The
  product should serve them deliberately (first-run admin setup, local email/password
  auth without Authentik, self-host docs), not just tolerate them.

Both audiences use it on desktop and on the phone (installable PWA), in English or
Indonesian.

## Product Purpose

Pocket tracks a household's entire portfolio (equities, ETFs, bonds, mutual funds / reksa
dana, gold, cash, loans) across brokers and currencies, and turns raw transactions into
net worth, performance (XIRR/TWR), income, allocation and rebalancing, savings-plan
tracking, and German or Indonesian tax figures. Success means the household trusts one
number for what they own and how it is doing, and spends minutes, not evenings, keeping
it current.

## Positioning

- **German and Indonesian finances in one place.** German tax mechanics (Vorabpauschale,
  Teilfreistellung, Sparerpauschbetrag/FSA, loss pots) and Indonesian assets (live IDX
  prices, reksa dana, Antam gold, the Indonesian final-tax regime) side by side, in
  multiple currencies, in an EN/ID interface.
- **Self-hosted and private.** The data lives on the user's own server; AGPL-3.0; no SaaS
  account, no third party holding the ledger.
- **Effortless import.** Screenshots read by LLM vision, broker CSV/PDF parsers (DKB, IBKR,
  Trade Republic, Coinbase), and direct sync (Trade Republic push-approval, IBKR Flex),
  all landing as drafts the user confirms, with duplicate detection across sources.

## Operating Context

- Broker documents and feeds are the raw material: TR and IBKR sync, PDF statements,
  CSV exports, phone screenshots of broker apps.
- Yearly tax rhythm: Freistellungsauftrag allocation per depot, Vorabpauschale, the
  German annual tax picture, or the Indonesian final-tax module, chosen per user.
- Access paths beyond the web UI: an in-app assistant, an MCP endpoint for claude.ai/mobile
  connectors (read-only by default; a write-scoped token can only propose draft imports),
  and personal access tokens.
- Deployment: self-hosted Docker stack (API + web) behind the host's own ingress; auth via
  Authentik OIDC or local email/password.

## Capabilities and Constraints

- Transactions are the single source of truth; holdings, P&L, cash, XIRR and net worth are
  derived, never stored.
- Imports never auto-commit: every parse becomes a draft the user confirms.
- Every portfolio declares whether cash is inside or outside its performance boundary.
- Missing data is disclosed, not hidden: a missing FX rate excludes the amount and says
  so; a holding without a price is valued at cost and flagged.
- Languages: English and Indonesian (next-intl). Number and date formats follow the app
  locale, not the browser.
- Domain terminology to keep: Freistellungsauftrag (FSA), Sparerpauschbetrag,
  Vorabpauschale, Teilfreistellung, Depotübertrag (transfer_in/out), reksa dana, cicilan.
- Not financial or tax advice; explanations only.

## Brand Commitments

- Name: **Pocket**. Logo: `apps/web/public/icon.svg`.
- Voice from shipped copy: plain, factual, quietly confident ("Every asset, one clear
  number." / "tracked in a single, honest figure"); no hype, no gamified finance language.

## Evidence on Hand

- Scripted demo dataset covering every asset class (`make demo`, `seed-demo.ts`), used for
  screenshots and visual checks; README stills in `docs/screenshots/` (`make screenshots`).
  Landing captures come from `make screenshots-landing` into the gitignored `landing-shots/`.
- Product and domain docs: `docs/tax.md`, `docs/loans.md`, `docs/mcp.md`,
  `docs/assistant.md`, broker docs (`trade_republic.md`, `interactive_brokers.md`,
  `dkb.md`), app audits in `docs/audits/`.
- No testimonials, user counts, press, or benchmarks exist; do not invent them.

## Product Principles

1. **One trustworthy number.** Every figure is derived from transactions, names its basis,
   and discloses what it could not measure rather than guessing.
2. **Two countries, first-class.** German and Indonesian finances are equal citizens;
   neither is a localisation afterthought.
3. **The user's data stays the user's.** Self-hosting, read-only by default, write access
   only when explicitly granted.
4. **Low-effort upkeep, human confirmation.** Automate getting data in; never commit it
   without the user's review.

## Accessibility & Inclusion

- Target: WCAG 2.2 AA.
- 44 px touch-target floor on mobile.
- Honour `prefers-reduced-motion`, `prefers-reduced-transparency` and
  `prefers-contrast: more`; charts respect reduced motion.
- Full English and Indonesian parity, with locale-correct number formats.
