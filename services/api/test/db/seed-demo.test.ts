import { describe, it, expect, afterEach, vi } from "vitest";
import { desc, eq } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { lastPrices, portfolios, portfolioSnapshots, users } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import type { FastifyBaseLogger } from "fastify";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { valuePortfolio } from "../../src/services/valuation.js";
import { recordDailySnapshots } from "../../src/services/snapshots.js";

/**
 * SEED_EMAIL/SEED_PASSWORD (and DEMO_AUTH_SUB, which depends on them) are read from
 * `process.env` once at module load — set the env before this file's first (and only)
 * import of seed-demo.ts so the module-level constants pick it up.
 */
process.env.SEED_DEMO_EMAIL = "seed-demo-admin-test@example.com";
process.env.SEED_DEMO_PASSWORD = "bootstrap-password"; // pragma: allowlist secret
const { seedDemo } = await import("../../src/db/seed-demo.js");

describe("seedDemo — admin bootstrap", () => {
  afterEach(async () => {
    await getDb().delete(users).where(eq(users.email, "seed-demo-admin-test@example.com"));
    await closeDb();
  });

  it("seeds the demo user as admin when a local password is set", async () => {
    await ensureDb();
    // `make seed-demo-login SEED_DEMO_PASSWORD=...` (README/.env.example) is the
    // documented alternative to POST /auth/local/setup for bootstrapping a self-host —
    // it must produce an admin, or GET /auth/local/setup-status (which closes the
    // moment any user exists) permanently locks the deployment out of /admin/*.
    await seedDemo();

    const [row] = await getDb()
      .select({
        isAdmin: users.isAdmin,
        authSub: users.authSub,
        onboardingCompletedAt: users.onboardingCompletedAt,
      })
      .from(users)
      .where(eq(users.email, "seed-demo-admin-test@example.com"));
    expect(row.isAdmin).toBe(true);
    expect(row.authSub).toBe("local|seed-demo-admin-test@example.com");
    // The demo user owns a full dataset, so it must not be gated into onboarding.
    expect(row.onboardingCompletedAt).not.toBeNull();
  }, 30_000);
});

describe("seedDemo — snapshot history anchored to the live valuation (#989)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await getDb().delete(users).where(eq(users.email, "seed-demo-admin-test@example.com"));
    await closeDb();
  });

  it("ends each portfolio's history on exactly what the daily snapshot job writes", async () => {
    // Any network call (market-data or FX provider) fails the test.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("seed-demo must not hit the network"));
    await ensureDb();
    await seedDemo();
    const db = getDb();

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "seed-demo-admin-test@example.com"));
    const pfs = await db.select().from(portfolios).where(eq(portfolios.userId, user.id));
    expect(pfs).toHaveLength(5);

    // The seed's clock: every lastPrices row is stamped at its module-level NOW.
    const [{ asOf }] = await db.select({ asOf: lastPrices.asOf }).from(lastPrices).limit(1);
    const now = new Date(asOf);

    let quoteCalls = 0;
    const stub = {
      getQuotes: async () => {
        quoteCalls++;
        return {};
      },
    } as unknown as MarketDataService;

    for (const p of pfs) {
      // Same call recordDailySnapshots (services/snapshots.ts) makes for each portfolio.
      const { summary } = await valuePortfolio(
        db,
        stub,
        24 * 60 * 60 * 1000,
        p.id,
        p.baseCurrency,
        undefined,
        p.cashCounted,
        undefined,
        now,
      );
      expect(summary.fxMissingCurrencies).toEqual([]);
      const [last] = await db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.portfolioId, p.id))
        .orderBy(desc(portfolioSnapshots.date))
        .limit(1);
      expect(last.date).toBe(toDateKey(now));
      expect(last.currency).toBe(p.baseCurrency);
      // The job writes netWorth ← summary.netWorth, marketValue ← summary.totalMarketValue,
      // and no flow on a day without transactions.
      expect(new Decimal(last.netWorth).eq(summary.netWorth), `${p.name} netWorth`).toBe(true);
      expect(
        new Decimal(last.marketValue).eq(summary.totalMarketValue),
        `${p.name} marketValue`,
      ).toBe(true);
      expect(new Decimal(last.effectiveFlow).isZero(), `${p.name} effectiveFlow`).toBe(true);
    }

    // The invariant itself: the daily job's first run over the seeded data rewrites
    // today's rows with identical values. A per-portfolio failure is swallowed by the job
    // (and would leave the row untouched), so its logger must stay silent too.
    const todayKey = toDateKey(now);
    const todayRows = async () =>
      (await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.date, todayKey)))
        .filter((r) => pfs.some((p) => p.id === r.portfolioId))
        .map(({ portfolioId, netWorth, marketValue, effectiveFlow, currency }) => ({
          portfolioId,
          netWorth,
          marketValue,
          effectiveFlow,
          currency,
        }))
        .sort((a, b) => a.portfolioId.localeCompare(b.portfolioId));
    const before = await todayRows();
    expect(before).toHaveLength(5);
    const log = { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const written = await recordDailySnapshots(db, stub, 24 * 60 * 60 * 1000, now, log);
    expect(written).toBeGreaterThanOrEqual(5);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    const after = await todayRows();
    expect(after.map((r) => [r.netWorth, r.marketValue, r.currency])).toEqual(
      before.map((r) => [r.netWorth, r.marketValue, r.currency]),
    );
    for (const [i, r] of after.entries()) {
      expect(new Decimal(r.effectiveFlow).eq(before[i].effectiveFlow)).toBe(true);
    }

    expect(quoteCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);
});
