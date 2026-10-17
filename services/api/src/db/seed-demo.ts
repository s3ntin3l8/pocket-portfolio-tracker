import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  users,
  apiTokens,
  accountHolders,
  portfolios,
  instruments,
  transactions,
  lastPrices,
  fxRates,
  portfolioSnapshots,
  allocationTargets,
  corporateActions,
  benchmarkPrices,
} from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import { PAT_PREFIX, hashToken, hashPassword } from "../plugins/auth.js";
import { normalizeEmail } from "../routes/auth.js";
import { ensureDb, getDb, closeDb } from "./client.js";
import { valuePortfolio } from "../services/valuation.js";
import { boundaryFlowsAt, fxAtFlowDates } from "../routes/transactions/shared/flows.js";

/**
 * Rich demo dataset for the screenshot pipeline (see `scripts/screenshots.mjs` at the
 * repo root, and the plan doc `.claude/plans/can-we-make-some-distributed-seal.md`).
 * Distinct from `seed.ts` (a single near-empty admin user for a fresh dev DB) — this
 * seeds a full portfolio/transaction/price graph spanning every asset class so every
 * hero screen (dashboard, holdings, insights, reports, tax) renders real, non-empty
 * data. Idempotent: re-running deletes the demo user (cascades through every
 * FK-owned row) and rebuilds from scratch, so it's safe to run repeatedly against the
 * same throwaway PGlite dir.
 *
 * Writes the freshly-minted personal-access-token secret to `patOutPath` (never
 * hardcoded — avoids tripping detect-secrets and avoids a stale committed credential).
 * The screenshot driver reads it back to mint a forged Auth.js session cookie
 * (`Authorization: Bearer pt_…`) — see `apps/web/scripts/mint-session.mjs` for why
 * this bypasses Authentik without touching real auth code.
 *
 * Dates are relative to the run date (not hardcoded), so screenshots regenerated
 * later stay looking current rather than visibly stale.
 */

const SEED_EMAIL = normalizeEmail(process.env.SEED_DEMO_EMAIL || "demo@pocket.invalid");
const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD || "";
const DEMO_AUTH_SUB = SEED_PASSWORD ? `local|${SEED_EMAIL}` : "demo|pocket";

// --- date/number helpers --------------------------------------------------

const NOW = new Date();

/** `n` days before `NOW`, at a fixed intraday hour so ordering is stable. */
function daysAgo(n: number, hour = 10): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

const isoDate = toDateKey;

function dec(n: number, digits = 2): string {
  return n.toFixed(digits);
}

/** Deterministic pseudo-random in [0, 1), seeded by index — stable across runs for
 *  the same seed input so re-running produces the same-shaped (not identical-value,
 *  since dates shift) chart without a real RNG dependency. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The demo's shared daily market shock in [−0.5, 0.5), keyed by days before `NOW` like
 * the walks' noise (#1029). The seeded ^GSPC closes move with it, and every noisy
 * portfolio walk loads on it with {@link MARKET_LOADING}, so the Insights correlation
 * lands where a real equity portfolio against a broad index would, instead of the ≈0 of
 * two independent series. The offset keeps it clear of the walks' own seeds.
 */
function marketShock(daysAgoN: number): number {
  return pseudoRandom(daysAgoN + 50_000) - 0.5;
}

/**
 * Share of a walk's noise that is the market shock; the rest, `√(1 − β²)`, is the
 * walk's own, so the noise keeps its variance whatever β is.
 */
const MARKET_LOADING = 0.6;

/**
 * One portfolio's demo value path (#1020), daily from its first boundary flow to `today`:
 * `V_t = V_{t−1} · (1 + drift + noise(t)) + F_t`, where `F_t` is the day's net
 * contribution (the negated sum of that day's XIRR-convention `flows`) and `drift` is
 * solved by bisection so the final value equals `target` (the live valuation). Returns
 * one `{ date, value, flow }` per day; `flow` is `F_t`.
 *
 * Throws when no drift in a wide band reaches `target`, or when the path would dip below
 * zero (a withdrawal larger than the simulated balance) — a seed that can't be modelled
 * is a seed bug, not something to paper over.
 */
export function demoSnapshotWalk(args: {
  flows: { amount: number | string; date: Date }[];
  today: string;
  target: number;
  /** Daily return noise around the drift, keyed by days before `today`. */
  noise: (daysAgo: number) => number;
  label: string;
}): { date: string; value: number; flow: number }[] {
  const DAY_MS = 86_400_000;
  const byDay = new Map<string, number>();
  for (const f of args.flows) {
    const key = toDateKey(f.date);
    byDay.set(key, (byDay.get(key) ?? 0) - Number(f.amount));
  }
  if (byDay.size === 0) {
    throw new Error(`seed-demo: ${args.label} has no boundary flows to build a history from`);
  }
  const firstMs = Date.parse(`${[...byDay.keys()].sort()[0]}T00:00:00.000Z`);
  const days = Math.round((Date.parse(`${args.today}T00:00:00.000Z`) - firstMs) / DAY_MS);
  if (days < 0) {
    throw new Error(`seed-demo: ${args.label}'s first flow is after ${args.today}`);
  }
  const grid = Array.from({ length: days + 1 }, (_, i) => {
    const date = toDateKey(new Date(firstMs + i * DAY_MS));
    return { date, flow: byDay.get(date) ?? 0, noise: args.noise(days - i) };
  });
  const path = (annual: number) => {
    const drift = (1 + annual) ** (1 / 365) - 1;
    let value = 0;
    return grid.map(({ date, flow, noise }) => {
      value = value * (1 + drift + noise) + flow;
      return { date, value, flow };
    });
  };
  const endValue = (annual: number) => path(annual).at(-1)!.value;
  let lo = -0.9;
  let hi = 5;
  if (!(endValue(lo) <= args.target && args.target <= endValue(hi))) {
    throw new Error(`seed-demo: no drift takes ${args.label} to its live value ${args.target}`);
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (endValue(mid) < args.target) lo = mid;
    else hi = mid;
  }
  const out = path((lo + hi) / 2);
  const negative = out.find((p) => p.value < 0);
  if (negative) {
    throw new Error(`seed-demo: ${args.label}'s history dips below zero on ${negative.date}`);
  }
  return out;
}

/**
 * Real ^GSPC year-end closes (USD, price index), the demo benchmark's yearly anchors: each
 * seeded calendar year returns what the real index did (2021 +27%, 2022 −19%, 2023 +24%,
 * 2024 +23%, 2025 +16%) instead of whatever a year of pseudo-random shocks sums to.
 * Keyed by year; the anchor is that year's 31 December.
 */
export const DEMO_GSPC_YEAR_END_CLOSES: Readonly<Record<number, number>> = {
  2019: 3230.78,
  2020: 3756.07,
  2021: 4766.18,
  2022: 3839.5,
  2023: 4769.83,
  2024: 5881.63,
  2025: 6845.5,
};

/** The demo benchmark's close today: about the real index's level in October 2026. */
export const DEMO_GSPC_TODAY_CLOSE = 7800;

/**
 * The demo's ^GSPC closes, one per calendar day from `start` through `today` (#1029):
 * the shared-shock daily noise, bridged so the path passes exactly through each pin —
 * every year-end close in `yearEnds` strictly inside the range, plus `todayClose` today.
 * The opening close is the year-end anchors' log-linear interpolation at `start`, so
 * the series opens on a plausible level whatever date the demo is seeded on.
 *
 * In log space, `L_t = N_t + B_t`: `N_t` is the cumulative log of `1 + noise`, and `B_t`
 * interpolates `log(pin) − N` linearly between consecutive pins. Within a segment that is
 * a constant extra daily drift, so the day-to-day noise (and the correlation it carries)
 * is untouched while each year ends on its anchor. Each point carries that day's `drift`
 * (the bridge's log increment, 0 on the first day): the market regime the portfolio
 * walks load on too, so a year the index fell is a weaker year for them as well.
 */
export function demoBenchmarkWalk(args: {
  start: string;
  today: string;
  yearEnds: Readonly<Record<number, number>>;
  todayClose: number;
  /** Daily return noise, keyed by days before `today`. */
  noise: (daysAgo: number) => number;
}): { date: string; close: number; drift: number }[] {
  const DAY_MS = 86_400_000;
  const startMs = Date.parse(`${args.start}T00:00:00.000Z`);
  const days = Math.round((Date.parse(`${args.today}T00:00:00.000Z`) - startMs) / DAY_MS);
  if (days < 1) throw new Error(`seed-demo: ^GSPC needs a start before ${args.today}`);
  const dayOf = (date: string) =>
    Math.round((Date.parse(`${date}T00:00:00.000Z`) - startMs) / DAY_MS);

  const anchors = Object.entries(args.yearEnds)
    .map(([year, close]) => ({ day: dayOf(`${year}-12-31`), logClose: Math.log(close) }))
    .sort((a, b) => a.day - b.day);
  // Log-linear between the year-ends around `start`; the nearest one's level outside them.
  const before = anchors.filter((a) => a.day <= 0).at(-1);
  const after = anchors.find((a) => a.day > 0);
  const startLog =
    before && after
      ? before.logClose +
        ((after.logClose - before.logClose) * -before.day) / (after.day - before.day)
      : (before ?? after)!.logClose;
  const pins = [
    { day: 0, logClose: startLog },
    ...anchors.filter((a) => a.day > 0 && a.day < days),
    { day: days, logClose: Math.log(args.todayClose) },
  ];

  const cum: number[] = [0];
  for (let i = 1; i <= days; i++) cum.push(cum[i - 1]! + Math.log(1 + args.noise(days - i)));
  const out: { date: string; close: number; drift: number }[] = [];
  let seg = 0;
  let prevBridge = 0;
  for (let i = 0; i <= days; i++) {
    while (seg < pins.length - 2 && pins[seg + 1]!.day <= i) seg++;
    const a = pins[seg]!;
    const b = pins[seg + 1]!;
    const gapA = a.logClose - cum[a.day]!;
    const gapB = b.logClose - cum[b.day]!;
    const bridge = gapA + ((gapB - gapA) * (i - a.day)) / (b.day - a.day);
    out.push({
      date: toDateKey(new Date(startMs + i * DAY_MS)),
      close: Math.exp(cum[i]! + bridge),
      drift: i === 0 ? 0 : bridge - prevBridge,
    });
    prevBridge = bridge;
  }
  return out;
}

// --- seed ------------------------------------------------------------------

export async function seedDemo(patOutPath?: string): Promise<void> {
  const db = getDb();

  // Idempotent re-seed: delete the demo user, which cascades (onDelete: "cascade")
  // through account_holders, portfolios, instruments-owned transaction rows,
  // api_tokens, etc. down to every row this script owns. Instruments are global
  // reference data (not user-owned) — cleaned up separately by symbol below so a
  // re-run doesn't violate the (market, symbol) unique index.
  // Delete by email to handle authSub changes (e.g. PAT mode → local auth mode).
  await db.delete(users).where(eq(users.email, SEED_EMAIL));

  const passwordHash = SEED_PASSWORD ? hashPassword(SEED_PASSWORD) : undefined;
  const [user] = await db
    .insert(users)
    .values({
      authSub: DEMO_AUTH_SUB,
      email: SEED_EMAIL,
      name: "Demo",
      passwordHash,
      // In local-password mode this is the documented alternative to
      // POST /auth/local/setup for bootstrapping a self-host (README, .env.example) —
      // it must produce an admin for the same reason that route does: GET
      // /auth/local/setup-status closes the bootstrap the moment ANY user row exists,
      // and only an existing admin can promote one via PATCH /admin/users/:id/admin.
      // A non-admin first user here would permanently lock the deployment out of
      // /admin/*. Not set in PAT/dev-bypass mode (no password) — that path already gets
      // isAdmin from NODE_ENV === "development" (plugins/auth.ts), not this column.
      isAdmin: Boolean(SEED_PASSWORD),
      // The demo user already owns a full dataset — without this, the first visit after
      // `make dev-setup` is bounced into the new-user onboarding wizard (the same
      // backfill rule the onboarding migration applies to users with real portfolios).
      // Real users are gated in apps/web's (app) layout: a resolved `me` with a null
      // `onboardingCompletedAt` redirects to /onboarding until /me's onboarding-complete
      // route (routes/me.ts) sets it. Seeding it here only exempts the demo user.
      onboardingCompletedAt: new Date(),
    })
    .returning();

  // pt_ + 43 url-safe chars (32 bytes) — same shape routes/me.ts mints for a real PAT.
  // When no output path is given AND the target is a PGlite dev database, use a
  // deterministic secret so the value can be hardcoded in the dev environment config
  // (DEV_AUTH_TOKEN in .env). A random secret is used for any real Postgres database
  // to prevent planting a known backdoor credential in a shared/staging environment.
  const isDevPglite = !patOutPath && process.env.DATABASE_URL?.startsWith("pglite://");
  const secret = isDevPglite
    ? `${PAT_PREFIX}dev-pat-for-local-development-only`
    : `${PAT_PREFIX}${randomBytes(32).toString("base64url")}`;
  await db.insert(apiTokens).values({
    userId: user.id,
    name: "screenshot-pipeline",
    scope: "write",
    tokenHash: hashToken(secret),
    tokenPrefix: secret.slice(0, 12),
  });

  // --- Account holders -----------------------------------------------------

  const [self, child] = await db
    .insert(accountHolders)
    .values([
      {
        userId: user.id,
        // Deliberately generic/fictional — this name renders directly in captured
        // screenshots (e.g. the Tax screen's "{holder} — {year}" header), which land
        // in the README and the PWA manifest. Never a real name (CLAUDE.md: "No
        // personal/account-holder names… in public artifacts").
        name: "Sample Investor",
        type: "self",
        birthYear: NOW.getUTCFullYear() - 34,
        // German tax profile: FSA cap + effective KapSt+Soli rate — powers /tax.
        taxAllowanceAnnual: "1000",
        capitalGainsTaxRate: "0.26375",
        churchTax: false,
        taxResidence: "DE",
      },
      {
        userId: user.id,
        name: "Sample Child",
        type: "child",
        birthYear: NOW.getUTCFullYear() - 9,
      },
    ])
    .returning();

  // --- Portfolios ------------------------------------------------------------

  const [idPortfolio, trPortfolio, goldPortfolio, mfPortfolio, cashPortfolio] = await db
    .insert(portfolios)
    .values([
      {
        userId: user.id,
        name: "Stockbit — IDX Equities",
        baseCurrency: "IDR",
        accountHolderId: self.id,
        brokerage: "Stockbit",
        cashCounted: false,
      },
      {
        userId: user.id,
        name: "Trade Republic",
        baseCurrency: "EUR",
        accountHolderId: self.id,
        brokerage: "Trade Republic",
        cashCounted: false,
        // Per-depot FSA allocation, within the holder's €1,000 cap above.
        taxAllowanceAnnual: "1000",
      },
      {
        userId: user.id,
        name: "Pegadaian Gold",
        baseCurrency: "IDR",
        accountHolderId: self.id,
        brokerage: "Pegadaian",
        cashCounted: false,
      },
      {
        userId: user.id,
        name: "Bibit Reksa Dana",
        baseCurrency: "IDR",
        accountHolderId: child.id,
        brokerage: "Bibit",
        cashCounted: false,
      },
      {
        userId: user.id,
        name: "DKB Tagesgeld",
        baseCurrency: "EUR",
        accountHolderId: self.id,
        brokerage: "DKB",
        // Cash-inside boundary: a savings account, not a mixed checking account.
        cashCounted: true,
      },
    ])
    .returning();

  // --- Instruments (global reference data) ----------------------------------

  // Clean up any prior demo run's instruments by symbol (they're not owned by the
  // demo user, so the cascading delete above doesn't touch them).
  const symbols = [
    "BBCA",
    "BBRI",
    "BYON",
    "GOTO",
    "TLKM",
    "ORI020",
    "ORI023",
    "GSRT",
    "VWCE",
    "IWDA",
    "VFV",
    "AAPL",
    "MSFT",
    "XAUIDR",
    "RDSAHAM",
  ];
  for (const symbol of symbols) {
    await db.delete(instruments).where(eq(instruments.symbol, symbol));
  }

  const [
    bbca,
    bbri,
    byon,
    goto_,
    tlkm,
    ori020,
    ori023,
    gsrt,
    vwce,
    iwda,
    vfv,
    aapl,
    msft,
    xau,
    rdSaham,
  ] = await db
    .insert(instruments)
    .values([
      {
        symbol: "BBCA",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "PT Bank Central Asia Tbk",
        displayName: "Bank Central Asia",
        sector: "Financials",
      },
      {
        symbol: "BBRI",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "PT Bank Rakyat Indonesia Tbk",
        displayName: "Bank Rakyat Indonesia",
        sector: "Financials",
      },
      {
        symbol: "BYON",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "PT Bank Neo Commerce Tbk",
        displayName: "Bank Neo Commerce",
        sector: "Financials",
      },
      {
        symbol: "GOTO",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "PT GoTo Gojek Tokopedia Tbk",
        displayName: "GoTo Group",
        sector: "Technology",
      },
      {
        symbol: "TLKM",
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        name: "PT Telkom Indonesia Tbk",
        displayName: "Telkom Indonesia",
        sector: "Communication Services",
      },
      {
        symbol: "ORI020",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "Obligasi Negara Ritel ORI020",
        displayName: "ORI020 Retail Bond",
        faceValue: "1000000",
        couponRate: "0.0615",
        couponSchedule: "monthly",
        maturityDate: isoDate(daysAgo(900)),
      },
      {
        symbol: "ORI023",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "Obligasi Negara Ritel ORI023",
        displayName: "ORI023 Retail Bond",
        faceValue: "1000000",
        couponRate: "0.0575",
        couponSchedule: "monthly",
        maturityDate: isoDate(daysAgo(-540)),
      },
      {
        symbol: "GSRT",
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        name: "Surat Berharga Negara GSRT",
        displayName: "Gov Savings Bond GSRT",
        faceValue: "1000000",
        couponRate: "0.065",
        couponSchedule: "semiannual",
        maturityDate: isoDate(daysAgo(500)),
      },
      {
        symbol: "VWCE",
        market: "XETRA",
        assetClass: "etf",
        unit: "shares",
        currency: "EUR",
        name: "Vanguard FTSE All-World UCITS ETF",
        displayName: "Vanguard FTSE All-World",
        partialExemptionRate: "0.30",
      },
      {
        symbol: "IWDA",
        market: "XETRA",
        assetClass: "etf",
        unit: "shares",
        currency: "EUR",
        name: "iShares Core MSCI World UCITS ETF",
        displayName: "iShares Core MSCI World",
        partialExemptionRate: "0.30",
      },
      {
        symbol: "VFV",
        market: "TSX",
        assetClass: "etf",
        unit: "shares",
        currency: "CAD",
        name: "Vanguard S&P 500 Index ETF",
        displayName: "Vanguard S&P 500",
        partialExemptionRate: "0.30",
      },
      {
        symbol: "AAPL",
        market: "US",
        assetClass: "equity",
        unit: "shares",
        currency: "USD",
        name: "Apple Inc.",
        displayName: "Apple",
        sector: "Technology",
      },
      {
        symbol: "MSFT",
        market: "US",
        assetClass: "equity",
        unit: "shares",
        currency: "USD",
        name: "Microsoft Corporation",
        displayName: "Microsoft",
        sector: "Technology",
      },
      {
        symbol: "XAUIDR",
        market: "XAU",
        assetClass: "gold",
        unit: "grams",
        currency: "IDR",
        name: "Emas Antam",
        displayName: "Gold (Antam)",
      },
      {
        symbol: "RDSAHAM",
        market: "IDX",
        assetClass: "mutual_fund",
        unit: "units",
        currency: "IDR",
        name: "Reksa Dana Saham Nusantara",
        displayName: "Reksa Dana Saham Nusantara",
      },
    ])
    .returning();

  // --- Transactions ------------------------------------------------------------
  //
  // Spans buy/sell/dividend/coupon/interest/savings_plan/deposit/withdrawal/
  // transfer_in/transfer_out/bonus_cash/fee/tax/adjustment — every major type
  // the UI renders except `split` (which is modeled via `corporate_actions`
  // rows below — a `split` transaction is a no-op in the engine and was removed).
  // Data ranges from ~2020 to present (~2200 days) so Reports, Insights, and
  // Tax screens have multi-year history to show.

  const txRows: (typeof transactions.$inferInsert)[] = [];

  // =========================================================================
  // Stockbit — IDX Equities (IDR)
  // =========================================================================

  // --- BBCA (Bank Central Asia) — long-term hold with dividend income ---
  txRows.push(
    // 2020: Initial position
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "buy",
      quantity: "500",
      price: "6200",
      fees: "6200",
      currency: "IDR",
      executedAt: daysAgo(2100),
    },
    // 2021: Add to position
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "buy",
      quantity: "300",
      price: "7800",
      fees: "4680",
      currency: "IDR",
      executedAt: daysAgo(1800),
    },
    // 2021: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "dividend",
      quantity: "0",
      price: "150000",
      perShare: "300",
      shares: "500",
      currency: "IDR",
      executedAt: daysAgo(1700),
    },
    // 2022: Add more
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "buy",
      quantity: "200",
      price: "8500",
      fees: "3400",
      currency: "IDR",
      executedAt: daysAgo(1500),
    },
    // 2022: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "dividend",
      quantity: "0",
      price: "240000",
      perShare: "300",
      shares: "800",
      currency: "IDR",
      executedAt: daysAgo(1400),
    },
    // 2023: Add
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "buy",
      quantity: "300",
      price: "9200",
      fees: "5520",
      currency: "IDR",
      executedAt: daysAgo(1100),
    },
    // 2023: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "dividend",
      quantity: "0",
      price: "300000",
      perShare: "300",
      shares: "1000",
      currency: "IDR",
      executedAt: daysAgo(1050),
    },
    // 2024: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "dividend",
      quantity: "0",
      price: "330000",
      perShare: "330",
      shares: "1000",
      currency: "IDR",
      executedAt: daysAgo(700),
    },
    // 2025: Partial sell
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "sell",
      quantity: "200",
      price: "10500",
      fees: "4200",
      currency: "IDR",
      executedAt: daysAgo(400),
    },
    // 2025: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbca.id,
      type: "dividend",
      quantity: "0",
      price: "264000",
      perShare: "330",
      shares: "800",
      currency: "IDR",
      executedAt: daysAgo(160),
    },
  );

  // --- BBRI (Bank Rakyat Indonesia) — transfer in, dividends, partial transfer out ---
  txRows.push(
    // 2021: Transferred in from another depot
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbri.id,
      type: "transfer_in",
      quantity: "1000",
      price: "4200",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1800),
    },
    // 2022: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbri.id,
      type: "dividend",
      quantity: "0",
      price: "165000",
      perShare: "165",
      shares: "1000",
      currency: "IDR",
      executedAt: daysAgo(1400),
    },
    // 2023: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbri.id,
      type: "dividend",
      quantity: "0",
      price: "185000",
      perShare: "185",
      shares: "1000",
      currency: "IDR",
      executedAt: daysAgo(1050),
    },
    // 2023: Transfer out to Trade Republic
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbri.id,
      type: "transfer_out",
      quantity: "400",
      price: "4200",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1000),
    },
    // 2024: Dividend (on remaining 600 shares)
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbri.id,
      type: "dividend",
      quantity: "0",
      price: "111000",
      perShare: "185",
      shares: "600",
      currency: "IDR",
      executedAt: daysAgo(700),
    },
    // 2025: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: bbri.id,
      type: "dividend",
      quantity: "0",
      price: "120000",
      perShare: "200",
      shares: "600",
      currency: "IDR",
      executedAt: daysAgo(160),
    },
  );

  // --- BYON (Bank Neo Commerce) — growth story, bonus cash, sell at loss ---
  txRows.push(
    // 2022: Initial buy
    {
      portfolioId: idPortfolio.id,
      instrumentId: byon.id,
      type: "buy",
      quantity: "2000",
      price: "1850",
      fees: "7400",
      currency: "IDR",
      executedAt: daysAgo(1500),
    },
    // 2022: Broker promo bonus
    {
      portfolioId: idPortfolio.id,
      instrumentId: byon.id,
      type: "bonus_cash",
      quantity: "0",
      price: "50000",
      currency: "IDR",
      executedAt: daysAgo(1480),
    },
    // 2023: Add more
    {
      portfolioId: idPortfolio.id,
      instrumentId: byon.id,
      type: "buy",
      quantity: "1500",
      price: "1200",
      fees: "3600",
      currency: "IDR",
      executedAt: daysAgo(1200),
    },
    // 2024: Sell half at a loss
    {
      portfolioId: idPortfolio.id,
      instrumentId: byon.id,
      type: "sell",
      quantity: "1750",
      price: "950",
      fees: "3325",
      currency: "IDR",
      executedAt: daysAgo(800),
    },
    // 2025: Buy the dip
    {
      portfolioId: idPortfolio.id,
      instrumentId: byon.id,
      type: "buy",
      quantity: "3000",
      price: "1100",
      fees: "6600",
      currency: "IDR",
      executedAt: daysAgo(500),
    },
  );

  // --- GOTO (GoTo Group) — IPO buy, quick sell ---
  txRows.push(
    // 2022: IPO buy
    {
      portfolioId: idPortfolio.id,
      instrumentId: goto_.id,
      type: "buy",
      quantity: "5000",
      price: "316",
      fees: "3160",
      currency: "IDR",
      executedAt: daysAgo(1550),
    },
    // 2022: Transaction fee
    {
      portfolioId: idPortfolio.id,
      instrumentId: goto_.id,
      type: "fee",
      quantity: "0",
      price: "2500",
      currency: "IDR",
      executedAt: daysAgo(1540),
    },
    // 2023: Sell at a loss
    {
      portfolioId: idPortfolio.id,
      instrumentId: goto_.id,
      type: "sell",
      quantity: "5000",
      price: "185",
      fees: "1850",
      currency: "IDR",
      executedAt: daysAgo(1200),
    },
  );

  // --- TLKM (Telkom Indonesia) ---
  txRows.push(
    // 2020: Buy
    {
      portfolioId: idPortfolio.id,
      instrumentId: tlkm.id,
      type: "buy",
      quantity: "400",
      price: "3400",
      fees: "5440",
      currency: "IDR",
      executedAt: daysAgo(2000),
    },
    // 2021: Dividend
    {
      portfolioId: idPortfolio.id,
      instrumentId: tlkm.id,
      type: "dividend",
      quantity: "0",
      price: "128000",
      perShare: "320",
      shares: "400",
      currency: "IDR",
      executedAt: daysAgo(1700),
    },
    // 2023: Sell
    {
      portfolioId: idPortfolio.id,
      instrumentId: tlkm.id,
      type: "sell",
      quantity: "400",
      price: "3900",
      fees: "6240",
      currency: "IDR",
      executedAt: daysAgo(1100),
    },
  );

  // --- ORI020 (Retail Bond 2020) — bought at issuance, coupons, matured ---
  txRows.push(
    // 2020: Buy at issuance
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori020.id,
      type: "buy",
      quantity: "80",
      price: "1000000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(2100),
    },
    // 2021: Monthly coupons — 80 units × 1,000,000 × 6.15% / 12 = 410,000 IDR each
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori020.id,
      type: "coupon",
      quantity: "0",
      price: "410000",
      currency: "IDR",
      executedAt: daysAgo(1800),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori020.id,
      type: "coupon",
      quantity: "0",
      price: "410000",
      currency: "IDR",
      executedAt: daysAgo(1770),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori020.id,
      type: "coupon",
      quantity: "0",
      price: "410000",
      currency: "IDR",
      executedAt: daysAgo(1740),
    },
    // 2024: Bond matured (maturityDate daysAgo(900)) — principal redeemed at face
    // a few days after the maturity exDate, so the sell post-dates the maturity.
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori020.id,
      type: "sell",
      quantity: "80",
      price: "1000000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(895),
    },
  );

  // --- ORI023 (Retail Bond 2023) ---
  txRows.push(
    // 2023: Buy at issuance
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori023.id,
      type: "buy",
      quantity: "50",
      price: "1000000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1100),
    },
    // 2023-2025: Monthly coupons (4 shown)
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori023.id,
      type: "coupon",
      quantity: "0",
      price: "239583",
      currency: "IDR",
      executedAt: daysAgo(1050),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori023.id,
      type: "coupon",
      quantity: "0",
      price: "239583",
      currency: "IDR",
      executedAt: daysAgo(700),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori023.id,
      type: "coupon",
      quantity: "0",
      price: "239583",
      currency: "IDR",
      executedAt: daysAgo(400),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: ori023.id,
      type: "coupon",
      quantity: "0",
      price: "239583",
      currency: "IDR",
      executedAt: daysAgo(80),
    },
  );

  // --- GSRT (Gov Savings Bond) — 2-year term, semi-annual coupons ---
  txRows.push(
    // 2022: Buy at issuance
    {
      portfolioId: idPortfolio.id,
      instrumentId: gsrt.id,
      type: "buy",
      quantity: "30",
      price: "1000000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1500),
    },
    // Semi-annual coupons — 30 units × 1,000,000 × 6.5% / 2 = 975,000 IDR each
    {
      portfolioId: idPortfolio.id,
      instrumentId: gsrt.id,
      type: "coupon",
      quantity: "0",
      price: "975000",
      currency: "IDR",
      executedAt: daysAgo(1350),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: gsrt.id,
      type: "coupon",
      quantity: "0",
      price: "975000",
      currency: "IDR",
      executedAt: daysAgo(1150),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: gsrt.id,
      type: "coupon",
      quantity: "0",
      price: "975000",
      currency: "IDR",
      executedAt: daysAgo(950),
    },
    {
      portfolioId: idPortfolio.id,
      instrumentId: gsrt.id,
      type: "coupon",
      quantity: "0",
      price: "975000",
      currency: "IDR",
      executedAt: daysAgo(750),
    },
    // 2024: Maturity (principal returned via implicit redemption)
    {
      portfolioId: idPortfolio.id,
      instrumentId: gsrt.id,
      type: "sell",
      quantity: "30",
      price: "1000000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(550),
    },
  );

  // =========================================================================
  // Trade Republic (EUR) — VWCE Sparplan + manual ETF/US-equity buys.
  // =========================================================================

  // --- VWCE (Vanguard FTSE All-World) — 48-month Sparplan (2021-2025) ---
  for (let i = 0; i < 48; i++) {
    const monthsAgo = 48 - i;
    txRows.push({
      portfolioId: trPortfolio.id,
      instrumentId: vwce.id,
      type: "savings_plan",
      quantity: dec(0.7 + pseudoRandom(i) * 0.5, 4),
      price: dec(85 + pseudoRandom(i * 7) * 30, 2),
      fees: "0",
      currency: "EUR",
      executedAt: daysAgo(monthsAgo * 30),
      savingsPlanId: "vwce-sparplan",
    });
  }
  // VWCE dividends — `shares` reflects position at the dividend date, not the
  // final ~45.6 total. (Strictly, VWCE is accumulating and wouldn't pay these in
  // reality; we keep the rows for screenshot coverage of the dividend UI.)
  txRows.push(
    {
      portfolioId: trPortfolio.id,
      instrumentId: vwce.id,
      type: "dividend",
      quantity: "0",
      price: "0.85",
      perShare: "0.85",
      shares: "1",
      currency: "EUR",
      executedAt: daysAgo(1400),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: vwce.id,
      type: "dividend",
      quantity: "0",
      price: "12.88",
      perShare: "0.92",
      shares: "14",
      currency: "EUR",
      executedAt: daysAgo(1050),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: vwce.id,
      type: "dividend",
      quantity: "0",
      price: "25.50",
      perShare: "1.02",
      shares: "25",
      currency: "EUR",
      executedAt: daysAgo(700),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: vwce.id,
      type: "dividend",
      quantity: "0",
      price: "40.70",
      perShare: "1.10",
      shares: "37",
      currency: "EUR",
      executedAt: daysAgo(350),
    },
  );

  // --- IWDA (iShares MSCI World) ---
  txRows.push(
    {
      portfolioId: trPortfolio.id,
      instrumentId: iwda.id,
      type: "buy",
      quantity: "12",
      price: "62.40",
      fees: "1.00",
      currency: "EUR",
      executedAt: daysAgo(1800),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: iwda.id,
      type: "buy",
      quantity: "8",
      price: "78.40",
      fees: "1.00",
      currency: "EUR",
      executedAt: daysAgo(1200),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: iwda.id,
      type: "dividend",
      quantity: "0",
      price: "6.00",
      perShare: "0.30",
      shares: "20",
      currency: "EUR",
      executedAt: daysAgo(1050),
    },
    // 2025: Vorabpauschale advance lump-sum fund tax (German-only, fires
    // annually on accumulating ETFs). `kind: "vorabpauschale"` is what the
    // trade-log uses to net it against future realized gains.
    {
      portfolioId: trPortfolio.id,
      instrumentId: iwda.id,
      type: "tax",
      kind: "vorabpauschale",
      quantity: "0",
      price: "0",
      vorabBase: "2.45",
      currency: "EUR",
      executedAt: daysAgo(580),
    },
  );

  // --- VFV (Vanguard S&P 500, CAD) ---
  txRows.push(
    {
      portfolioId: trPortfolio.id,
      instrumentId: vfv.id,
      type: "buy",
      quantity: "20",
      price: "115.30",
      fees: "1.50",
      currency: "CAD",
      executedAt: daysAgo(1100),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: vfv.id,
      type: "fee",
      quantity: "0",
      price: "2.50",
      currency: "CAD",
      executedAt: daysAgo(1090),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: vfv.id,
      type: "dividend",
      quantity: "0",
      price: "7.20",
      perShare: "0.36",
      shares: "20",
      currency: "CAD",
      executedAt: daysAgo(700),
    },
    {
      portfolioId: trPortfolio.id,
      instrumentId: vfv.id,
      type: "dividend",
      quantity: "0",
      price: "8.40",
      perShare: "0.42",
      shares: "20",
      currency: "CAD",
      executedAt: daysAgo(350),
    },
  );

  // --- AAPL (Apple) — buy, 4:1 split, more buys, sell, dividends ---
  txRows.push(
    // 2020: Initial buy
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "buy",
      quantity: "5",
      price: "80.50",
      fees: "1.00",
      currency: "USD",
      executedAt: daysAgo(2000),
    },
    // 2020: 4-for-1 stock split — applied via corporate_actions row below
    // (engine reads splits from the corporate_actions table, not transactions;
    // a `split` transaction row is a no-op and breaks the position's qty math).
    // Now holding 20 shares (5 × 4)
    // 2021: Dividend (0.22 × 20 = 4.40)
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "dividend",
      quantity: "0",
      price: "4.40",
      perShare: "0.22",
      shares: "20",
      currency: "USD",
      executedAt: daysAgo(1700),
    },
    // 2022: Buy more
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "buy",
      quantity: "10",
      price: "150.20",
      fees: "1.00",
      currency: "USD",
      executedAt: daysAgo(1500),
    },
    // 2022: Dividend (0.22 × 30 = 6.60)
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "dividend",
      quantity: "0",
      price: "6.60",
      perShare: "0.22",
      shares: "30",
      currency: "USD",
      executedAt: daysAgo(1400),
    },
    // 2023: Dividend (0.24 × 30 = 7.20)
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "dividend",
      quantity: "0",
      price: "7.20",
      perShare: "0.24",
      shares: "30",
      currency: "USD",
      executedAt: daysAgo(1050),
    },
    // 2024: Dividend (0.25 × 30 = 7.50)
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "dividend",
      quantity: "0",
      price: "7.50",
      perShare: "0.25",
      shares: "30",
      currency: "USD",
      executedAt: daysAgo(700),
    },
    // 2025: Sell some
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "sell",
      quantity: "15",
      price: "221.30",
      fees: "1.00",
      currency: "USD",
      executedAt: daysAgo(400),
    },
    // 2025: Dividend (on remaining 15)
    {
      portfolioId: trPortfolio.id,
      instrumentId: aapl.id,
      type: "dividend",
      quantity: "0",
      price: "4.20",
      perShare: "0.28",
      shares: "15",
      currency: "USD",
      executedAt: daysAgo(160),
    },
  );

  // --- MSFT (Microsoft) ---
  txRows.push(
    // 2021: Buy
    {
      portfolioId: trPortfolio.id,
      instrumentId: msft.id,
      type: "buy",
      quantity: "5",
      price: "240.80",
      fees: "1.00",
      currency: "USD",
      executedAt: daysAgo(1800),
    },
    // 2022: Dividend (0.62 × 5 = 3.10)
    {
      portfolioId: trPortfolio.id,
      instrumentId: msft.id,
      type: "dividend",
      quantity: "0",
      price: "3.10",
      perShare: "0.62",
      shares: "5",
      currency: "USD",
      executedAt: daysAgo(1400),
    },
    // 2023: Buy more
    {
      portfolioId: trPortfolio.id,
      instrumentId: msft.id,
      type: "buy",
      quantity: "8",
      price: "280.50",
      fees: "1.00",
      currency: "USD",
      executedAt: daysAgo(1100),
    },
    // 2023: Dividend
    {
      portfolioId: trPortfolio.id,
      instrumentId: msft.id,
      type: "dividend",
      quantity: "0",
      price: "8.06",
      perShare: "0.62",
      shares: "13",
      currency: "USD",
      executedAt: daysAgo(1050),
    },
    // 2024: Dividend (position 13: 5 buy @1800 + 8 buy @1100, no sells)
    {
      portfolioId: trPortfolio.id,
      instrumentId: msft.id,
      type: "dividend",
      quantity: "0",
      price: "9.75",
      perShare: "0.75",
      shares: "13",
      currency: "USD",
      executedAt: daysAgo(700),
    },
    // 2025: Dividend
    {
      portfolioId: trPortfolio.id,
      instrumentId: msft.id,
      type: "dividend",
      quantity: "0",
      price: "10.40",
      perShare: "0.80",
      shares: "13",
      currency: "USD",
      executedAt: daysAgo(160),
    },
  );

  // =========================================================================
  // Pegadaian Gold (IDR) — long-term accumulation, one partial sell.
  // =========================================================================
  txRows.push(
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "buy",
      quantity: "5",
      price: "850000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(2100),
    },
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "buy",
      quantity: "10",
      price: "950000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1800),
    },
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "buy",
      quantity: "15",
      price: "1050000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1500),
    },
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "buy",
      quantity: "10",
      price: "1150000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(1100),
    },
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "buy",
      quantity: "10",
      price: "1250000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(700),
    },
    // 2024: Partial sell (take some profit)
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "sell",
      quantity: "15",
      price: "1350000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(500),
    },
    {
      portfolioId: goldPortfolio.id,
      instrumentId: xau.id,
      type: "buy",
      quantity: "5",
      price: "1400000",
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(300),
    },
  );

  // =========================================================================
  // Bibit Reksa Dana (IDR, child holder) — 36-month Sparplan + dividends.
  // =========================================================================
  for (let i = 0; i < 36; i++) {
    const monthsAgo = 36 - i;
    txRows.push({
      portfolioId: mfPortfolio.id,
      instrumentId: rdSaham.id,
      type: "savings_plan",
      quantity: dec(300 + pseudoRandom(i * 3) * 300, 2),
      price: dec(1350 + pseudoRandom(i * 11) * 200, 2),
      fees: "0",
      currency: "IDR",
      executedAt: daysAgo(monthsAgo * 30),
      savingsPlanId: "rdsaham-sparplan",
    });
  }
  // Reksa dana dividends (annual distributions)
  txRows.push(
    {
      portfolioId: mfPortfolio.id,
      instrumentId: rdSaham.id,
      type: "dividend",
      quantity: "0",
      price: "85000",
      currency: "IDR",
      executedAt: daysAgo(1050),
    },
    {
      portfolioId: mfPortfolio.id,
      instrumentId: rdSaham.id,
      type: "dividend",
      quantity: "0",
      price: "110000",
      currency: "IDR",
      executedAt: daysAgo(700),
    },
    {
      portfolioId: mfPortfolio.id,
      instrumentId: rdSaham.id,
      type: "dividend",
      quantity: "0",
      price: "125000",
      currency: "IDR",
      executedAt: daysAgo(350),
    },
    // Broker promo bonus
    {
      portfolioId: mfPortfolio.id,
      instrumentId: rdSaham.id,
      type: "bonus_cash",
      quantity: "0",
      price: "25000",
      currency: "IDR",
      executedAt: daysAgo(1200),
    },
  );

  // =========================================================================
  // DKB Tagesgeld (EUR, cash-inside boundary) — deposits, withdrawals,
  // quarterly interest, bonus cash, and an adjustment correction.
  // =========================================================================
  txRows.push(
    // 2020: Initial deposit
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "deposit",
      quantity: "0",
      price: "3000",
      currency: "EUR",
      executedAt: daysAgo(2100),
    },
    // 2021: Deposit
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "deposit",
      quantity: "0",
      price: "2000",
      currency: "EUR",
      executedAt: daysAgo(1800),
    },
    // 2021: Interest (quarterly)
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "3.75",
      currency: "EUR",
      executedAt: daysAgo(1750),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "3.75",
      currency: "EUR",
      executedAt: daysAgo(1660),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "4.50",
      currency: "EUR",
      executedAt: daysAgo(1570),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "4.50",
      currency: "EUR",
      executedAt: daysAgo(1480),
    },
    // 2022: Deposit
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "deposit",
      quantity: "0",
      price: "1500",
      currency: "EUR",
      executedAt: daysAgo(1500),
    },
    // 2022: Withdrawal
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "withdrawal",
      quantity: "0",
      price: "1000",
      currency: "EUR",
      executedAt: daysAgo(1350),
    },
    // 2022: Interest (rising rates)
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "8.25",
      currency: "EUR",
      executedAt: daysAgo(1300),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "12.50",
      currency: "EUR",
      executedAt: daysAgo(1200),
    },
    // 2023: Deposit
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "deposit",
      quantity: "0",
      price: "2000",
      currency: "EUR",
      executedAt: daysAgo(1100),
    },
    // 2023: Broker sign-up bonus
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "bonus_cash",
      quantity: "0",
      price: "50",
      currency: "EUR",
      executedAt: daysAgo(1080),
    },
    // 2023: Interest
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "22.50",
      currency: "EUR",
      executedAt: daysAgo(1000),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "28.75",
      currency: "EUR",
      executedAt: daysAgo(900),
    },
    // 2024: Deposit
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "deposit",
      quantity: "0",
      price: "1200",
      currency: "EUR",
      executedAt: daysAgo(800),
    },
    // 2024: Withdrawal
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "withdrawal",
      quantity: "0",
      price: "800",
      currency: "EUR",
      executedAt: daysAgo(600),
    },
    // 2024: Cash adjustment (correction)
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "adjustment",
      quantity: "0",
      price: "35.50",
      currency: "EUR",
      executedAt: daysAgo(550),
    },
    // 2024: Interest
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "32.00",
      currency: "EUR",
      executedAt: daysAgo(700),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "34.50",
      currency: "EUR",
      executedAt: daysAgo(450),
    },
    // 2025: Interest
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "36.20",
      currency: "EUR",
      executedAt: daysAgo(350),
    },
    {
      portfolioId: cashPortfolio.id,
      instrumentId: null,
      type: "interest",
      quantity: "0",
      price: "38.10",
      currency: "EUR",
      executedAt: daysAgo(150),
    },
  );

  await db.insert(transactions).values(txRows);

  // --- Last prices (drives live valuation without hitting a market-data provider —
  // see MARKET_DATA_TTL_MS in the orchestrator env) + previous close for day-change. ---

  const asOf = NOW;

  // --- Corporate actions (stock splits, mergers, etc.) ---
  // The engine applies splits via this table — `ev.ca.ratio` in holdings.ts,
  // lots.ts, and trade-log/compute.ts — not via transaction rows. A `split`
  // transaction is a no-op (QTY_AFFECTING_TYPES in holdings.ts excludes it).
  // Without this row, AAPL would be 5 + 10 − 15 = 0 shares (position closed,
  // no partial position left for the report/trade-log screens to show).
  await db.insert(corporateActions).values({
    instrumentId: aapl.id,
    type: "split",
    ratio: "4",
    exDate: isoDate(daysAgo(1950)),
    terms: "4-for-1 stock split",
  });
  await db.insert(lastPrices).values([
    { instrumentId: bbca.id, price: "10150", previousClose: "10025", currency: "IDR", asOf },
    { instrumentId: bbri.id, price: "4850", previousClose: "4780", currency: "IDR", asOf },
    { instrumentId: byon.id, price: "1280", previousClose: "1250", currency: "IDR", asOf },
    { instrumentId: goto_.id, price: "210", previousClose: "205", currency: "IDR", asOf },
    { instrumentId: tlkm.id, price: "3980", previousClose: "4010", currency: "IDR", asOf },
    { instrumentId: ori020.id, price: "1000000", previousClose: "1000000", currency: "IDR", asOf },
    { instrumentId: ori023.id, price: "1005000", previousClose: "1004200", currency: "IDR", asOf },
    { instrumentId: gsrt.id, price: "1000000", previousClose: "1000000", currency: "IDR", asOf },
    { instrumentId: vwce.id, price: "118.40", previousClose: "117.10", currency: "EUR", asOf },
    { instrumentId: iwda.id, price: "89.75", previousClose: "89.20", currency: "EUR", asOf },
    { instrumentId: vfv.id, price: "142.50", previousClose: "141.20", currency: "CAD", asOf },
    { instrumentId: aapl.id, price: "228.90", previousClose: "231.50", currency: "USD", asOf },
    { instrumentId: msft.id, price: "412.30", previousClose: "408.60", currency: "USD", asOf },
    { instrumentId: xau.id, price: "1520000", previousClose: "1510000", currency: "IDR", asOf },
    { instrumentId: rdSaham.id, price: "1850", previousClose: "1842", currency: "IDR", asOf },
  ]);

  // --- FX rates — daily history 2020-today for every currency pair the
  // seeded holdings actually need. See fx.ts: rows are (base=from, quote=to,
  // date), read for `quote = displayCurrency`. IDR is the default aggregate
  // display currency; EUR/USD/CAD are the foreign currencies any holding has.

  // Scope cleanup to only the pairs this seed owns — the table is global
  // reference data shared with other users/devs on a shared dev DB, so
  // `delete(fxRates)` would nuke everyone else's cache.
  const seededPairs = [
    { base: "EUR", quote: "IDR" },
    { base: "USD", quote: "IDR" },
    { base: "USD", quote: "EUR" },
    { base: "CAD", quote: "IDR" },
    { base: "CAD", quote: "EUR" },
  ];
  for (const { base, quote } of seededPairs) {
    await db.delete(fxRates).where(and(eq(fxRates.base, base), eq(fxRates.quote, quote)));
  }

  // Quarterly anchors for the three IDR legs only; every other rate is derived, so all
  // conversion paths agree (USD→EUR × EUR→IDR == USD→IDR, same for CAD).
  const fxStartDate = new Date(Date.UTC(2020, 0, 1));
  const quartersSinceStart = (NOW.getUTCFullYear() - 2020) * 4 + Math.floor(NOW.getUTCMonth() / 3);
  const anchors: { date: Date; eurIdr: number; usdIdr: number; cadIdr: number }[] = [];
  for (let q = 0; q <= quartersSinceStart; q++) {
    const date = new Date(fxStartDate);
    date.setUTCMonth(date.getUTCMonth() + q * 3);
    if (date > NOW) break;
    const t = q / quartersSinceStart; // 0 at 2020-01, 1 at now
    anchors.push({
      date,
      // EUR/IDR: 15200 → 17450 (gradual rise)
      eurIdr: 15200 + t * 2250 + pseudoRandom(q * 13) * 300,
      // USD/IDR: 13600 → 16100
      usdIdr: 13600 + t * 2500 + pseudoRandom(q * 17) * 250,
      // CAD/IDR: 10500 → 11900
      cadIdr: 10500 + t * 1400 + pseudoRandom(q * 29) * 200,
    });
  }

  // End the series on today at the trend's end value, so the last partial quarter keeps moving
  // instead of holding flat from the latest quarter start.
  const todayStart = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
  if (anchors[anchors.length - 1]!.date < todayStart) {
    anchors.push({
      date: todayStart,
      eurIdr: 15200 + 2250 + pseudoRandom(13) * 300,
      usdIdr: 13600 + 2500 + pseudoRandom(17) * 250,
      cadIdr: 10500 + 1400 + pseudoRandom(29) * 200,
    });
  }

  // One row per calendar day, linearly interpolated between anchors (today's row is the
  // final anchor). A date more than FX_MAX_CARRY_FORWARD_DAYS
  // from a row would make getFxRatesForDates fetch live rates and splice them over the seeded
  // walk — a step in the aggregate history — so the table must have no such gaps.
  const DAY_MS = 86_400_000;
  const fxRows: (typeof fxRates.$inferInsert)[] = [];
  let seg = 0;
  for (let ms = fxStartDate.getTime(); ms <= NOW.getTime(); ms += DAY_MS) {
    while (seg < anchors.length - 1 && anchors[seg + 1]!.date.getTime() <= ms) seg++;
    const lo = anchors[seg]!;
    const hi = anchors[seg + 1];
    const f = hi ? (ms - lo.date.getTime()) / (hi.date.getTime() - lo.date.getTime()) : 0;
    const at = (a: number, b: number | undefined) => (b === undefined ? a : a + (b - a) * f);
    const eurIdr = new Decimal(at(lo.eurIdr, hi?.eurIdr).toFixed(0));
    const usdIdr = new Decimal(at(lo.usdIdr, hi?.usdIdr).toFixed(0));
    const cadIdr = new Decimal(at(lo.cadIdr, hi?.cadIdr).toFixed(0));
    const dateStr = isoDate(new Date(ms));
    const row = (base: string, quote: string, rate: Decimal) => ({
      base,
      quote,
      rate: rate.toDecimalPlaces(10).toFixed(),
      date: dateStr,
    });
    fxRows.push(
      row("EUR", "IDR", eurIdr),
      row("USD", "IDR", usdIdr),
      row("USD", "EUR", usdIdr.div(eurIdr)),
      row("CAD", "IDR", cadIdr),
      row("CAD", "EUR", cadIdr.div(eurIdr)),
    );
  }
  for (let i = 0; i < fxRows.length; i += 1000) {
    await db.insert(fxRates).values(fxRows.slice(i, i + 1000));
  }

  // --- Portfolio snapshots (daily net-worth history → dashboard/savings charts). ---
  // Each portfolio's history is built from its REAL boundary flows (#1020): exactly the
  // flows the per-year XIRR reads (`boundaryFlowsAt`, kind-aware, under the portfolio's own
  // `cashCounted` boundary, each converted to the base currency at its own date's rate),
  // on their real dates. From the first flow, the value walks forward day by day:
  //
  //   V_t = V_{t−1} · (1 + r_t) + F_t,   r_t = drift + noise_t
  //
  // with F_t the day's net contribution and a deterministic noise term (partly the
  // `marketShock` and yearly regime of the seeded ^GSPC closes below, #1029). `drift` is solved
  // by bisection so today's V equals the live valuation. Because the flows are the XIRR's
  // flows and the values are their consequence, each year's XIRR and TWR describe the same
  // path; a synthetic contribution schedule (the old "10 units, then 1 every 30 days")
  // paired the real flows with a NAV that never received them.
  //
  // One scale for all three columns: `netWorth` = V; `marketValue` and `effectiveFlow` =
  // V and F times the securities sleeve's share of today's net worth. In this dataset that
  // share is exactly 1 for every outside-boundary portfolio (net worth is the securities)
  // and 0 for the cash-only Tagesgeld (cash inside its boundary, no securities), so TWR,
  // which reads only the sleeve, ignores the Tagesgeld as the daily job does; no demo
  // portfolio has a fractional share. TWR's 1 + r_t = (V_t − flow_t) / V_{t−1} then
  // recovers r_t exactly. Today's flow (none in this dataset) lands on today's row.
  //
  // A modelling choice, not the daily job's bookkeeping: outside the boundary a sell,
  // dividend or coupon is money leaving to the investor, so here it leaves the sleeve
  // too (a negative `effectiveFlow` that day), where the job values the securities alone
  // and books only trades. Each day's (value, flow) pair is self-consistent either way.
  //
  // The walk is anchored to the live valuation: today's point is exactly what
  // `recordDailySnapshots` (services/snapshots.ts) will write for the portfolio — same
  // `valuePortfolio` call, same summary fields per column — so the job's first run
  // doesn't put a visible step into the history chart on the seed date (#989). The
  // valuation reads the `lastPrices`/FX/corporate-action rows inserted above; the stub
  // quote service throws so a missing price row fails the seed instead of reaching a
  // live provider. The flows convert with the seeded, triangular `fx_rates` rows above
  // (#1006/#1021), which cover every day since before the first transaction.

  // Every member access throws, so any provider path a future valuation adds fails with
  // this message too, not an `undefined is not a function`.
  const offlineQuotes = new Proxy({} as MarketDataService, {
    get(_target, prop) {
      throw new Error(
        `seed-demo: valuation reached the quote service (${String(prop)}) — every seeded instrument needs a fresh lastPrices row`,
      );
    },
  });
  // `getCachedQuotes` measures freshness against the wall clock, not `NOW`; the rows were
  // stamped at `NOW` a moment ago, so any generous TTL keeps them fresh.
  const ANCHOR_TTL_MS = 24 * 60 * 60 * 1000;

  /**
   * Daily noise amplitude around the solved drift (0: a smooth savings-account path), and
   * the seed of the walk's own share of it (the rest is the shared `marketShock`, #1029).
   */
  const walkParams: { portfolio: typeof portfolios.$inferSelect; noise: number; seed: number }[] = [
    { portfolio: idPortfolio, noise: 0.012, seed: 10_000 },
    { portfolio: trPortfolio, noise: 0.01, seed: 20_000 },
    { portfolio: goldPortfolio, noise: 0.008, seed: 30_000 },
    { portfolio: mfPortfolio, noise: 0.004, seed: 40_000 },
    { portfolio: cashPortfolio, noise: 0, seed: 0 },
  ];
  const ownLoading = Math.sqrt(1 - MARKET_LOADING ** 2);
  // Chunk the inserts — PGlite/postgres both handle a few thousand rows fine in one
  // call, but batching keeps this robust if the portfolio/day count grows later.
  const CHUNK = 500;

  // Each portfolio's live valuation and real boundary flows, first: the benchmark below
  // starts a quarter before the earliest flow, and the walks then load on its regime.
  const valued: ((typeof walkParams)[number] & {
    summary: Awaited<ReturnType<typeof valuePortfolio>>["summary"];
    flows: ReturnType<typeof boundaryFlowsAt>;
  })[] = [];
  for (const params of walkParams) {
    const { portfolio } = params;
    const { summary, coreTxns, corporateActions } = await valuePortfolio(
      db,
      offlineQuotes,
      ANCHOR_TTL_MS,
      portfolio.id,
      portfolio.baseCurrency,
      undefined,
      portfolio.cashCounted,
      undefined,
      NOW,
    );
    if (summary.fxMissingCurrencies.length > 0) {
      // The daily job would skip this portfolio; anchoring to a partial value is wrong.
      throw new Error(
        `seed-demo: no FX rate for ${summary.fxMissingCurrencies.join(", ")} → ${portfolio.baseCurrency}`,
      );
    }
    const flows = boundaryFlowsAt(
      coreTxns,
      portfolio.cashCounted ? "inside" : "outside",
      portfolio.baseCurrency,
      await fxAtFlowDates(db, coreTxns, portfolio.baseCurrency),
      corporateActions,
    );
    valued.push({ ...params, summary, flows });
  }

  // --- Benchmark closes (^GSPC, the default reference index) (#1029). ---
  // Without seeded closes the demo fetched live ^GSPC history, so the Insights benchmark
  // card needed the network, changed from run to run, and correlated ≈0 with the
  // deterministic walks below. The seeded series walks on the same `marketShock` the
  // portfolio walks load on: up to ±1.5% a day (RMS about 0.9%, an index's usual daily
  // move), in USD like the real index, from a quarter before the first snapshot (late 2020
  // in this dataset) to about the real level today. `demoBenchmarkWalk` bridges it through
  // the real index's year-end closes, so each calendar year returns what the S&P 500 did;
  // left to the shocks alone, a year came out anywhere from −4% to +51% (2022, a −19% year).
  //
  // One row per calendar day, weekends included, from that start through today.
  // `ensureBenchmarkPrices` then finds every snapshot date covered and never fetches: it
  // wants an exact row for today and yesterday whatever the weekday, so weekday-only rows
  // would fetch whenever the demo is seeded on a weekend. `computeActiveReturn` pairs the
  // two series by exact date, so daily rows also give the card every snapshot day
  // (about 2,100 pairs instead of about 1,500).
  const BENCHMARK_NOISE = 0.03;
  const firstFlowKey = valued
    .flatMap((v) => v.flows.map((f) => toDateKey(f.date)))
    .reduce((min, d) => (d < min ? d : min), isoDate(NOW));
  const benchmarkWalk = demoBenchmarkWalk({
    start: isoDate(new Date(Date.parse(`${firstFlowKey}T00:00:00.000Z`) - 92 * DAY_MS)),
    today: isoDate(NOW),
    yearEnds: DEMO_GSPC_YEAR_END_CLOSES,
    todayClose: DEMO_GSPC_TODAY_CLOSE,
    noise: (daysAgoN) => BENCHMARK_NOISE * marketShock(daysAgoN),
  });
  const benchmarkRows: (typeof benchmarkPrices.$inferInsert)[] = benchmarkWalk.map((p) => ({
    userId: user.id,
    symbol: "^GSPC",
    date: p.date,
    close: dec(p.close),
    currency: "USD",
    source: "demo",
  }));
  for (let i = 0; i < benchmarkRows.length; i += CHUNK) {
    await db.insert(benchmarkPrices).values(benchmarkRows.slice(i, i + CHUNK));
  }
  /** The benchmark's bridge drift (its yearly regime), keyed by days before `NOW`. */
  const marketRegime = (daysAgoN: number) =>
    benchmarkWalk[benchmarkWalk.length - 1 - daysAgoN]?.drift ?? 0;

  const snapshotRows: (typeof portfolioSnapshots.$inferInsert)[] = [];
  for (const { portfolio, noise, seed, summary, flows } of valued) {
    const walk = demoSnapshotWalk({
      flows,
      today: isoDate(NOW),
      target: Number(summary.netWorth),
      // The regime at the shock's own relative loading: a walk with a tenth of the index's
      // shock exposure also takes a tenth of its yearly drift, so a year the index fell is
      // a weaker year here too, and the Tagesgeld (noise 0) stays smooth.
      noise: (daysAgoN) =>
        noise *
        (MARKET_LOADING * marketShock(daysAgoN) +
          ownLoading * (pseudoRandom(daysAgoN + seed) - 0.5) +
          (MARKET_LOADING / BENCHMARK_NOISE) * marketRegime(daysAgoN)),
      label: portfolio.name,
    });
    const netWorth = Number(summary.netWorth);
    const sleeve = netWorth === 0 ? 0 : Number(summary.totalMarketValue) / netWorth;
    for (const { date, value, flow } of walk) {
      // Today's row takes the summary strings verbatim: `dec()` rounds to 2 dp, and the
      // row must equal what the job writes exactly.
      const isToday = date === isoDate(NOW);
      snapshotRows.push({
        portfolioId: portfolio.id,
        date,
        netWorth: isToday ? summary.netWorth : dec(value),
        marketValue: isToday ? summary.totalMarketValue : dec(value * sleeve),
        effectiveFlow: dec(flow * sleeve),
        currency: portfolio.baseCurrency,
      });
    }
  }
  for (let i = 0; i < snapshotRows.length; i += CHUNK) {
    await db.insert(portfolioSnapshots).values(snapshotRows.slice(i, i + CHUNK));
  }

  // --- Allocation targets (aggregate asset-class mix → dashboard drift hint). ---

  await db.insert(allocationTargets).values([
    {
      userId: user.id,
      portfolioId: null,
      dimension: "asset_class",
      targetKey: "equity",
      targetPct: "40",
    },
    {
      userId: user.id,
      portfolioId: null,
      dimension: "asset_class",
      targetKey: "etf",
      targetPct: "25",
    },
    {
      userId: user.id,
      portfolioId: null,
      dimension: "asset_class",
      targetKey: "gold",
      targetPct: "10",
    },
    {
      userId: user.id,
      portfolioId: null,
      dimension: "asset_class",
      targetKey: "bond",
      targetPct: "15",
    },
    {
      userId: user.id,
      portfolioId: null,
      dimension: "asset_class",
      targetKey: "mutual_fund",
      targetPct: "10",
    },
  ]);

  if (patOutPath) {
    await writeFile(patOutPath, secret, "utf8");
  }

  console.log(`Demo data seeded for user ${user.id} (${txRows.length} transactions).`);
}

// Allow running directly: `tsx src/db/seed-demo.ts [patOutPath]`.
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  await ensureDb();
  await seedDemo(process.argv[2]);
  await closeDb();
}
