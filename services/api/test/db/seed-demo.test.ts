import { describe, it, expect, afterAll, afterEach, beforeAll, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair } from "jose";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import {
  benchmarkPrices,
  fxRates,
  lastPrices,
  portfolios,
  portfolioSnapshots,
  users,
} from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import type { MarketDataService } from "@portfolio/market-data";
import type { FastifyBaseLogger } from "fastify";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { getFxRatesForDates } from "../../src/services/fx.js";
import type { FxProvider } from "../../src/services/fx.js";
import { valuePortfolio } from "../../src/services/valuation.js";
import { recordDailySnapshots } from "../../src/services/snapshots.js";
import {
  clearBenchmarkFetchCache,
  earliestUnsatisfiedBenchmarkDate,
} from "../../src/services/benchmark.js";
import { buildApp } from "../../src/app.js";

/**
 * SEED_EMAIL/SEED_PASSWORD (and DEMO_AUTH_SUB, which depends on them) are read from
 * `process.env` once at module load — set the env before this file's first (and only)
 * import of seed-demo.ts so the module-level constants pick it up.
 */
process.env.SEED_DEMO_EMAIL = "seed-demo-admin-test@example.com";
process.env.SEED_DEMO_PASSWORD = "bootstrap-password"; // pragma: allowlist secret
const { seedDemo, demoSnapshotWalk } = await import("../../src/db/seed-demo.js");

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
    const [{ asOf }] = await db
      .select({ asOf: lastPrices.asOf })
      .from(lastPrices)
      .orderBy(desc(lastPrices.asOf))
      .limit(1);
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

describe("seedDemo — FX rates (#989, #1006)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await getDb().delete(users).where(eq(users.email, "seed-demo-admin-test@example.com"));
    await closeDb();
  });

  const rel = (a: Decimal.Value, b: Decimal.Value) => new Decimal(a).sub(b).abs().div(b);

  it("has a rate for every recent day, so no lookup reaches a live provider", async () => {
    await ensureDb();
    await seedDemo();
    const db = getDb();
    const provider = {
      getRate: vi.fn(async () => null),
      getRateHistory: vi.fn(async () => ({})),
    } satisfies FxProvider;
    const dates = Array.from({ length: 400 }, (_, i) =>
      toDateKey(new Date(Date.now() - i * 864e5)),
    );
    const rates = await getFxRatesForDates(db, ["EUR", "USD", "CAD"], "IDR", dates, provider);
    expect(provider.getRate).not.toHaveBeenCalled();
    expect(provider.getRateHistory).not.toHaveBeenCalled();
    // No step: consecutive days move by well under 1%.
    const sorted = [...dates].sort();
    for (let i = 1; i < sorted.length; i++) {
      for (const ccy of ["EUR", "USD", "CAD"]) {
        const prev = rates.get(sorted[i - 1])![ccy];
        const cur = rates.get(sorted[i])![ccy];
        expect(prev && cur, `${ccy} ${sorted[i]}`).toBeTruthy();
        expect(rel(cur, prev).lt("0.005"), `${ccy} ${sorted[i]}`).toBe(true);
      }
    }
  }, 60_000);

  it("is triangularly consistent: USD→EUR × EUR→IDR == USD→IDR (same for CAD)", async () => {
    await ensureDb();
    await seedDemo();
    const rows = await getDb().select().from(fxRates);
    const byDate = new Map<string, Map<string, string>>();
    for (const r of rows) {
      if (!byDate.has(r.date)) byDate.set(r.date, new Map());
      byDate.get(r.date)!.set(`${r.base}:${r.quote}`, r.rate);
    }
    let checked = 0;
    for (const [, m] of byDate) {
      const eurIdr = m.get("EUR:IDR");
      if (!eurIdr) continue;
      for (const ccy of ["USD", "CAD"]) {
        const direct = m.get(`${ccy}:IDR`);
        const cross = m.get(`${ccy}:EUR`);
        if (!direct || !cross) continue;
        expect(rel(new Decimal(cross).mul(eurIdr), direct).lt("1e-9")).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  }, 60_000);
});

describe("seedDemo — GET /insights on the seeded history (#1020, #1029)", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let insights: {
    yearlyReturns: { year: number; portfolioTwr: string | null; portfolioXirr: string | null }[];
    benchmark: { symbol: string; activeReturn: string; correlation: string } | null;
  };
  // Any network call (a live benchmark or FX fetch) is recorded here. `ensureBenchmarkPrices`
  // swallows fetch errors, so the assertion is "never called", not "didn't throw".
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "10000";
    clearBenchmarkFetchCache();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("the seeded demo must not hit the network"));
    await ensureDb();
    dir = await mkdtemp(join(tmpdir(), "seed-demo-insights-"));
    await seedDemo(join(dir, "pat"));
    app = await buildApp({ authKey: (await generateKeyPair("ES256")).publicKey });
    const pat = (await readFile(join(dir, "pat"), "utf8")).trim();
    const res = await app.inject({
      method: "GET",
      url: "/insights?range=all",
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(res.statusCode).toBe(200);
    insights = res.json();
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    // Before app.close(), which closes the shared DB handle.
    await getDb().delete(users).where(eq(users.email, "seed-demo-admin-test@example.com"));
    await app.close();
    await closeDb();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RATE_LIMIT_MAX;
  });

  // The seeded snapshot history is driven by the portfolios' real boundary flows, so each
  // year's money-weighted return (flows + year-end net worth, as GET /insights computes
  // it) describes the same path as its time-weighted return. The old synthetic history
  // paired the real flows with a NAV that never received them: −76% XIRR against +7% TWR.
  it("gives every year a finite XIRR within 15pp of that year's TWR", () => {
    const rows = insights.yearlyReturns;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      const twr = Number(r.portfolioTwr);
      const xirr = Number(r.portfolioXirr);
      expect(r.portfolioTwr, `${r.year} TWR`).not.toBeNull();
      expect(r.portfolioXirr, `${r.year} XIRR`).not.toBeNull();
      expect(Number.isFinite(xirr), `${r.year} XIRR ${r.portfolioXirr}`).toBe(true);
      expect(Math.abs(xirr - twr), `${r.year}: XIRR ${xirr} vs TWR ${twr}`).toBeLessThan(0.15);
    }
  });

  // The benchmark is seeded from a walk that shares a market factor with the equity
  // walks' daily noise, so the card reads like a real equity portfolio against the S&P 500
  // rather than the ≈0 of an independent walk against live closes. The floor sits above
  // the 0.6 loading on purpose: with independent own-noise per walk the aggregate
  // diversifies to ≈0.7, while walks sharing one own-series (the old `id.length` seed)
  // would collapse to exactly the loading.
  it("correlates the portfolio with the seeded ^GSPC in a realistic band", () => {
    expect(insights.benchmark).not.toBeNull();
    expect(insights.benchmark!.symbol).toBe("^GSPC");
    const r = Number(insights.benchmark!.correlation);
    expect(r, `correlation ${r}`).toBeGreaterThanOrEqual(0.65);
    expect(r, `correlation ${r}`).toBeLessThanOrEqual(0.8);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("covers every snapshot date with seeded USD closes, so nothing is fetched", async () => {
    const db = getDb();
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "seed-demo-admin-test@example.com"));
    const pfIds = (
      await db.select({ id: portfolios.id }).from(portfolios).where(eq(portfolios.userId, user.id))
    ).map((p) => p.id);
    const dates = [
      ...new Set(
        (
          await db
            .select({ date: portfolioSnapshots.date })
            .from(portfolioSnapshots)
            .where(inArray(portfolioSnapshots.portfolioId, pfIds))
        ).map((r) => r.date),
      ),
    ].sort();
    expect(dates.length).toBeGreaterThan(1000);
    expect(await earliestUnsatisfiedBenchmarkDate(db, user.id, "^GSPC", dates)).toBeNull();

    const closes = await db
      .select()
      .from(benchmarkPrices)
      .where(and(eq(benchmarkPrices.userId, user.id), eq(benchmarkPrices.symbol, "^GSPC")))
      .orderBy(asc(benchmarkPrices.date));
    expect(closes.every((c) => c.currency === "USD")).toBe(true);
    expect(closes[0]!.date <= dates[0]!).toBe(true);
    expect(closes.at(-1)!.date).toBe(dates.at(-1));
    // Plausible S&P 500 levels: about 3,300 at the start, about 6,500 today.
    expect(Number(closes[0]!.close)).toBeCloseTo(3300, 0);
    expect(Number(closes.at(-1)!.close)).toBeCloseTo(6500, 0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("demoSnapshotWalk (#1020)", () => {
  const at = (date: string) => new Date(`${date}T10:00:00.000Z`);

  it("lands each net flow on its own day and ends on the target", () => {
    const walk = demoSnapshotWalk({
      // XIRR convention: negative = money in.
      flows: [
        { amount: -1000, date: at("2025-01-01") },
        { amount: "-500", date: at("2025-01-03") },
        { amount: 200, date: at("2025-01-05") },
      ],
      today: "2025-01-10",
      target: 1310,
      noise: () => 0,
      label: "test",
    });
    expect(walk.map((p) => p.date)).toEqual(
      Array.from({ length: 10 }, (_, i) => `2025-01-${String(i + 1).padStart(2, "0")}`),
    );
    expect(walk.map((p) => p.flow)).toEqual([1000, 0, 500, 0, -200, 0, 0, 0, 0, 0]);
    expect(walk.at(-1)!.value).toBeCloseTo(1310, 6);
    // TWR's 1 + r = (V_t − F_t) / V_{t−1} recovers one constant daily return (no noise).
    const r = walk.slice(1).map((p, i) => (p.value - p.flow) / walk[i]!.value - 1);
    for (const x of r) expect(x).toBeCloseTo(r[0]!, 9);
    expect(r[0]!).toBeGreaterThan(0); // 1,300 contributed net, 1,310 at the end
  });

  it("refuses a path that dips below zero", () => {
    expect(() =>
      demoSnapshotWalk({
        flows: [
          { amount: -100, date: at("2025-01-01") },
          { amount: 1000, date: at("2025-01-02") },
          { amount: -2000, date: at("2025-01-03") },
        ],
        today: "2025-01-04",
        target: 1100,
        noise: () => 0,
        label: "test",
      }),
    ).toThrow(/below zero/);
  });

  it("refuses flows that all lie after today", () => {
    expect(() =>
      demoSnapshotWalk({
        flows: [{ amount: -100, date: at("2025-02-01") }],
        today: "2025-01-01",
        target: 100,
        noise: () => 0,
        label: "test",
      }),
    ).toThrow(/after 2025-01-01/);
  });

  it("refuses a target no drift can reach", () => {
    expect(() =>
      demoSnapshotWalk({
        flows: [{ amount: -100, date: at("2025-01-01") }],
        today: "2025-01-02",
        target: 1_000_000,
        noise: () => 0,
        label: "test",
      }),
    ).toThrow(/no drift/);
  });
});

describe("getFxProvider — FX_PROVIDER=none", () => {
  it("FX_PROVIDER=none disables live lookups", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FX_PROVIDER", "none");
    const fresh = await import("../../src/services/fx.js");
    expect(fresh.getFxProvider()).toBeNull();
    vi.stubEnv("FX_PROVIDER", "");
    vi.resetModules();
    const live = await import("../../src/services/fx.js");
    expect(live.getFxProvider()).not.toBeNull();
    vi.unstubAllEnvs();
  });
});
