import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
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
} from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import { PAT_PREFIX, hashToken, hashPassword } from "../plugins/auth.js";
import { normalizeEmail } from "../routes/auth.js";
import { ensureDb, getDb, closeDb } from "./client.js";

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
        couponSchedule: "semi-annual",
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

  // --- FX rates — quarterly history 2020-today for every currency pair the
  // seeded holdings actually need. See fx.ts: rows are (base=from, quote=to,
  // date), read for `quote = displayCurrency`. IDR is the default aggregate
  // display currency; EUR/USD/CAD are the foreign currencies any holding has.

  const today = isoDate(NOW);

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

  const fxRows: (typeof fxRates.$inferInsert)[] = [];
  // Generate quarterly FX rates from Jan 2020 to today
  const fxStartDate = new Date(Date.UTC(2020, 0, 1));
  const quartersSinceStart = (NOW.getUTCFullYear() - 2020) * 4 + Math.floor(NOW.getUTCMonth() / 3);

  // Track the latest end-of-series rate per pair so we can stamp today's row
  // even when today doesn't fall on a quarter start (getFxRates does
  // eq(date, today) — a quarter-start-only seed would leave the live path
  // with no cached rate on the ~110 non-quarter-start days/year and fall
  // back to a live provider fetch).
  const latestByPair = new Map<string, string>();

  for (let q = 0; q <= quartersSinceStart; q++) {
    const date = new Date(fxStartDate);
    date.setUTCMonth(date.getUTCMonth() + q * 3);
    if (date > NOW) break;
    const dateStr = isoDate(date);
    const t = q / quartersSinceStart; // 0 at 2020-01, 1 at now
    // EUR/IDR: 15200 → 17450 (gradual rise)
    const eurIdr = 15200 + t * 2250 + pseudoRandom(q * 13) * 300;
    // USD/IDR: 13600 → 16100
    const usdIdr = 13600 + t * 2500 + pseudoRandom(q * 17) * 250;
    // USD/EUR: 0.89 → 0.923
    const usdEur = 0.89 + t * 0.033 + (pseudoRandom(q * 23) - 0.5) * 0.02;
    // CAD/IDR: 10500 → 11900
    const cadIdr = 10500 + t * 1400 + pseudoRandom(q * 29) * 200;
    // CAD/EUR: 0.65 → 0.68
    const cadEur = 0.65 + t * 0.03 + (pseudoRandom(q * 31) - 0.5) * 0.015;
    const row = (base: string, quote: string, rate: string) => {
      const key = `${base}:${quote}`;
      latestByPair.set(key, rate);
      return { base, quote, rate, date: dateStr };
    };
    fxRows.push(
      row("EUR", "IDR", dec(eurIdr, 0)),
      row("USD", "IDR", dec(usdIdr, 0)),
      row("USD", "EUR", dec(usdEur, 3)),
      row("CAD", "IDR", dec(cadIdr, 0)),
      row("CAD", "EUR", dec(cadEur, 3)),
    );
  }

  // Stamp today's row for every pair using the end-of-series rate, so the
  // live path's eq(date, today) lookup hits on any day, not just quarter starts.
  for (const { base, quote } of seededPairs) {
    const key = `${base}:${quote}`;
    const rate = latestByPair.get(key);
    if (rate && !fxRows.some((r) => r.base === base && r.quote === quote && r.date === today)) {
      fxRows.push({ base, quote, rate, date: today });
    }
  }
  await db.insert(fxRates).values(fxRows);

  // --- Portfolio snapshots (daily net-worth history → dashboard/savings charts). ---
  // A deterministic upward-drift-plus-noise walk from a small starting value to
  // roughly today's live-valued total, per portfolio — good enough for a chart to
  // look alive without re-deriving exact historical valuations from the transactions
  // above (that's the real backend job's responsibility, not this seed's).

  const portfolioEndValues: {
    portfolio: typeof portfolios.$inferSelect;
    end: number;
    currency: string;
    days: number;
  }[] = [
    // Stockbit: BBCA(1100@10.15k) + BBRI(600@4.85k) + BYON(4750@1.28k) + ORI023(50@1.005M)
    //   ≈ 70.4M IDR (ORI020 matured and was redeemed; GOTO/TLKM/GSRT fully sold)
    { portfolio: idPortfolio, end: 70_500_000, currency: "IDR", days: 2200 },
    // TR: VWCE(45.6@118.40) + IWDA(20@89.75) + AAPL(15@228.90 USD→EUR)
    //   + MSFT(13@412.30 USD→EUR) + VFV(20@142.50 CAD→EUR) ≈ 17.2k EUR
    { portfolio: trPortfolio, end: 17_500, currency: "EUR", days: 2100 },
    // Gold: 40g × 1.52M ≈ 60.8M IDR
    { portfolio: goldPortfolio, end: 61_000_000, currency: "IDR", days: 2100 },
    // Reksa dana: ~36 monthly buys × ~450 units × 1,850 ≈ 30M IDR
    { portfolio: mfPortfolio, end: 30_000_000, currency: "IDR", days: 1500 },
    // DKB cash: 9700 deposits − 1800 withdrawals + ~228 interest + 50 bonus + 35.5 adj ≈ 8,213 EUR
    { portfolio: cashPortfolio, end: 8_300, currency: "EUR", days: 2100 },
  ];

  const snapshotRows: (typeof portfolioSnapshots.$inferInsert)[] = [];
  for (const { portfolio, end, currency, days } of portfolioEndValues) {
    const start = end * 0.08;
    for (let d = days; d >= 0; d--) {
      const t = 1 - d / days; // 0 at the start date, 1 at today
      const trend = start + (end - start) * t;
      const noise = 1 + (pseudoRandom(d + portfolio.id.length) - 0.5) * 0.03;
      const netWorth = Math.max(0, trend * noise);
      snapshotRows.push({
        portfolioId: portfolio.id,
        date: isoDate(daysAgo(d)),
        netWorth: dec(netWorth),
        marketValue: dec(netWorth),
        effectiveFlow: "0",
        currency,
      });
    }
  }
  // Chunk the insert — PGlite/postgres both handle a few thousand rows fine in one
  // call, but batching keeps this robust if the portfolio/day count grows later.
  const CHUNK = 500;
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
