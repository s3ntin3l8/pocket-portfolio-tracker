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
  benchmarkClosesInCurrency,
  clearBenchmarkFetchCache,
  earliestUnsatisfiedBenchmarkDate,
  getBenchmarkPrices,
} from "../../src/services/benchmark.js";
import { buildApp } from "../../src/app.js";

/**
 * SEED_EMAIL/SEED_PASSWORD (and DEMO_AUTH_SUB, which depends on them) are read from
 * `process.env` once at module load — set the env before this file's first (and only)
 * import of seed-demo.ts so the module-level constants pick it up.
 */
process.env.SEED_DEMO_EMAIL = "seed-demo-admin-test@example.com";
process.env.SEED_DEMO_PASSWORD = "bootstrap-password"; // pragma: allowlist secret
const {
  seedDemo,
  demoSnapshotWalk,
  demoBenchmarkWalk,
  DEMO_GSPC_YEAR_END_CLOSES,
  DEMO_GSPC_TODAY,
} = await import("../../src/db/seed-demo.js");

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

  it("sets each demo portfolio's country, so cash interest is classified by it", async () => {
    await ensureDb();
    await seedDemo();
    const db = getDb();
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "seed-demo-admin-test@example.com"));
    const pfs = await db
      .select({ brokerage: portfolios.brokerage, country: portfolios.country })
      .from(portfolios)
      .where(eq(portfolios.userId, user.id));
    expect(Object.fromEntries(pfs.map((p) => [p.brokerage, p.country]))).toEqual({
      Stockbit: "ID",
      Pegadaian: "ID",
      Bibit: "ID",
      "Trade Republic": "DE",
      DKB: "DE",
    });
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

  it("also covers EUR as the display currency (the DE tax screenshots), inverse of EUR→IDR", async () => {
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
    // Without IDR→EUR rows the IDR holdings drop out of every EUR total (the "Exchange rate
    // missing" banner), since FX_PROVIDER=none leaves no live source to fill the pair.
    const toEur = await getFxRatesForDates(db, ["IDR", "USD", "CAD"], "EUR", dates, provider);
    const toIdr = await getFxRatesForDates(db, ["EUR"], "IDR", dates, provider);
    expect(provider.getRate).not.toHaveBeenCalled();
    expect(provider.getRateHistory).not.toHaveBeenCalled();
    for (const d of dates) {
      for (const ccy of ["IDR", "USD", "CAD"])
        expect(toEur.get(d)?.[ccy], `${ccy}→EUR ${d}`).toBeTruthy();
      const product = new Decimal(toEur.get(d)!.IDR!).mul(toIdr.get(d)!.EUR!);
      expect(rel(product, 1).lt("1e-9"), `IDR→EUR × EUR→IDR ${d}`).toBe(true);
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
    yearlyReturns: {
      year: number;
      portfolioTwr: string | null;
      portfolioXirr: string | null;
      benchmarks: { symbol: string; twr: string | null }[];
    }[];
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

  // The walks load on the index's yearly regime, not just its daily shocks: with only the
  // shocks shared, the portfolio's best year was the index's −19% year, and the yearly
  // table contradicted the daily correlation above.
  it("gives the portfolio its weakest year where the index has its weakest", () => {
    const rows = insights.yearlyReturns.filter((r) => r.benchmarks[0]?.twr != null);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const weakest = (pick: (r: (typeof rows)[number]) => number) =>
      rows.reduce((min, r) => (pick(r) < pick(min) ? r : min)).year;
    const bmWeakest = weakest((r) => Number(r.benchmarks[0]!.twr));
    expect(Number(rows.find((r) => r.year === bmWeakest)!.benchmarks[0]!.twr)).toBeLessThan(0);
    expect(weakest((r) => Number(r.portfolioTwr))).toBe(bmWeakest);
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
    // One close per calendar day, weekends included: carry-forward would hide weekday-only
    // rows above, except on a weekend, when the exact-row rule for today and yesterday
    // makes ensureBenchmarkPrices fetch.
    const span = (Date.parse(closes.at(-1)!.date) - Date.parse(closes[0]!.date)) / 86_400_000;
    expect(closes).toHaveLength(span + 1);
    // Plausible S&P 500 levels: between the real 2019 and 2025 year-ends at the start,
    // about the real level (7,800) today.
    expect(Number(closes[0]!.close)).toBeGreaterThan(3200);
    expect(Number(closes[0]!.close)).toBeLessThan(6900);
    expect(Number(closes.at(-1)!.close)).toBeCloseTo(7800, 0);

    // Every snapshot day survives the USD→IDR conversion the card applies, which silently
    // drops a day without a rate, so the correlation above is over the full pair set.
    const converted = await benchmarkClosesInCurrency(
      db,
      await getBenchmarkPrices(db, user.id, "^GSPC", dates),
      dates,
      "USD",
      "IDR",
      { cachedFxOnly: true },
    );
    expect(converted.fxMissingDates).toBe(0);
    expect(converted.closes).toHaveLength(dates.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The seeded ^GSPC used to drift straight from its start to today's close on a year's
  // worth of pseudo-random shocks, so 2022 came out about +50% where the real index lost
  // 19%. Each seeded calendar year now ends on the real index's year-end level.
  it("gives each seeded year about the real ^GSPC price return (USD)", async () => {
    const realReturns: Record<number, number> = {
      2021: 0.27,
      2022: -0.19,
      2023: 0.24,
      2024: 0.23,
      2025: 0.16,
    };
    const db = getDb();
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "seed-demo-admin-test@example.com"));
    const closes = await db
      .select({ date: benchmarkPrices.date, close: benchmarkPrices.close })
      .from(benchmarkPrices)
      .where(and(eq(benchmarkPrices.userId, user.id), eq(benchmarkPrices.symbol, "^GSPC")));
    const byDate = new Map(closes.map((c) => [c.date, Number(c.close)]));
    // Every year the table anchors inside the seeded range needs its real return above,
    // typed in by hand: next January's new close is then checked against reality too.
    for (const year of Object.keys(DEMO_GSPC_YEAR_END_CLOSES).map(Number)) {
      if (byDate.has(`${year - 1}-12-31`) && byDate.has(`${year}-12-31`)) {
        expect(realReturns, `add the real ${year} ^GSPC return here`).toHaveProperty(String(year));
      }
    }
    let checked = 0;
    for (const [year, real] of Object.entries(realReturns)) {
      const open = byDate.get(`${Number(year) - 1}-12-31`);
      const close = byDate.get(`${year}-12-31`);
      if (open === undefined || close === undefined) continue; // outside the seeded range
      const seeded = close / open - 1;
      expect(Math.abs(seeded - real), `${year}: seeded ${seeded}, real ${real}`).toBeLessThan(0.03);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

describe("seedDemo — Indonesian bank interest and the Rp7.5M exemption", () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  type Row = { category: string; exemption: string | null; gross: string; tax: string | null };
  /** Every bank-interest row of the seeded years, per holder name. */
  const rowsByHolder = new Map<string, Row[]>();

  beforeAll(async () => {
    process.env.RATE_LIMIT_MAX = "10000";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in the demo"));
    await ensureDb();
    dir = await mkdtemp(join(tmpdir(), "seed-demo-id-interest-"));
    await seedDemo(join(dir, "pat"));
    app = await buildApp({ authKey: (await generateKeyPair("ES256")).publicKey });
    const headers = {
      authorization: `Bearer ${(await readFile(join(dir, "pat"), "utf8")).trim()}`,
    };
    const prefs = await app.inject({
      method: "PUT",
      url: "/me/preferences",
      headers,
      payload: { taxRegime: "ID" },
    });
    expect(prefs.statusCode).toBe(200);
    // The interest is seeded 90–270 days ago, which can span two calendar years.
    const year = new Date().getUTCFullYear();
    for (const y of [year - 1, year]) {
      const res = await app.inject({ method: "GET", url: `/networth/tax?year=${y}`, headers });
      expect(res.statusCode).toBe(200);
      for (const entry of res.json() as {
        holder: { name: string };
        indonesianFinalTax: { income: Row[] };
      }[]) {
        const rows = entry.indonesianFinalTax.income.filter(
          (r) => r.category === "deposit_interest",
        );
        rowsByHolder.set(entry.holder.name, [
          ...(rowsByHolder.get(entry.holder.name) ?? []),
          ...rows,
        ]);
      }
    }
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await getDb().delete(users).where(eq(users.email, "seed-demo-admin-test@example.com"));
    await app.close();
    await closeDb();
    await rm(dir, { recursive: true, force: true });
    delete process.env.RATE_LIMIT_MAX;
  });

  const total = (rows: Row[], field: "gross" | "tax") =>
    rows.reduce((s, r) => s.add(r[field] ?? "0"), new Decimal(0)).toFixed(2);

  it("exempts the child's small Bibit balance: in the gross, no tax", () => {
    const rows = rowsByHolder.get("Sample Child") ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.exemption === "small_balance")).toBe(true);
    expect(total(rows, "gross")).toBe("20700.00");
    expect(total(rows, "tax")).toBe("0.00");
  });

  it("taxes the Stockbit RDN interest above the threshold at 20%", () => {
    const rows = rowsByHolder.get("Sample Investor") ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.exemption === null)).toBe(true);
    expect(total(rows, "gross")).toBe("188400.00");
    expect(total(rows, "tax")).toBe("37680.00");
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

describe("demoBenchmarkWalk", () => {
  const noise = (daysAgo: number) => 0.01 * Math.sin(daysAgo * 1.7);

  it("passes through every in-range year-end and today's close, one row per day", () => {
    const walk = demoBenchmarkWalk({
      start: "2020-10-01",
      today: "2023-06-30",
      // 2019 and 2023 lie outside the range: 2019 only shapes the opening level.
      yearEnds: { 2019: 3000, 2020: 4000, 2021: 5000, 2022: 4000, 2023: 9999 },
      todayClose: 4500,
      noise,
    });
    const byDate = new Map(walk.map((p) => [p.date, p]));
    expect(walk[0]!.date).toBe("2020-10-01");
    expect(walk.at(-1)!.date).toBe("2023-06-30");
    expect(walk).toHaveLength(1003);
    expect(byDate.get("2020-12-31")!.close).toBeCloseTo(4000, 6);
    expect(byDate.get("2021-12-31")!.close).toBeCloseTo(5000, 6);
    expect(byDate.get("2022-12-31")!.close).toBeCloseTo(4000, 6);
    expect(walk.at(-1)!.close).toBeCloseTo(4500, 6);
    // Opens on the log-linear interpolation between the 2019 and 2020 year-ends.
    const f = 275 / 366;
    expect(walk[0]!.close).toBeCloseTo(3000 * (4000 / 3000) ** f, 6);
  });

  it("keeps the daily noise, plus one constant drift per segment", () => {
    const walk = demoBenchmarkWalk({
      start: "2021-06-01",
      today: "2022-06-01",
      yearEnds: { 2021: 5000 },
      todayClose: 4000,
      noise,
    });
    const days = walk.length - 1;
    expect(walk[0]!.drift).toBe(0);
    for (let i = 1; i <= days; i++) {
      const ratio = walk[i]!.close / walk[i - 1]!.close;
      expect(ratio).toBeCloseTo((1 + noise(days - i)) * Math.exp(walk[i]!.drift), 10);
    }
    const yearEnd = walk.findIndex((p) => p.date === "2021-12-31");
    expect(walk[1]!.drift).toBeCloseTo(walk[yearEnd]!.drift, 12);
    expect(walk[yearEnd + 1]!.drift).toBeCloseTo(walk[days]!.drift, 12);
    expect(walk[yearEnd + 1]!.drift).not.toBeCloseTo(walk[yearEnd]!.drift, 6);
    // Before every anchor, the series opens on the nearest year-end's level.
    expect(walk[0]!.close).toBeCloseTo(5000, 6);
  });

  // The newest leg (last year-end → today) is unanchored: once a calendar year closes
  // without its real close in the table, that year's seeded return is drift again.
  it("has the real close of every completed year (one month's grace)", () => {
    const newest = Math.max(...Object.keys(DEMO_GSPC_YEAR_END_CLOSES).map(Number));
    const staleFrom = Date.UTC(newest + 1, 11, 31) + 31 * 86_400_000;
    expect(
      Date.now() < staleFrom,
      `add the real ${newest + 1} ^GSPC year-end close to DEMO_GSPC_YEAR_END_CLOSES and refresh DEMO_GSPC_TODAY`,
    ).toBe(true);
    // A year-end added without refreshing today's level would bridge toward a stale close.
    expect(DEMO_GSPC_TODAY.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      Date.parse(`${DEMO_GSPC_TODAY.asOf}T00:00:00.000Z`) > Date.UTC(newest, 11, 31),
      `refresh DEMO_GSPC_TODAY to a real level after ${newest}-12-31`,
    ).toBe(true);
  });

  it("refuses an empty anchor table", () => {
    expect(() =>
      demoBenchmarkWalk({
        start: "2025-01-01",
        today: "2025-01-02",
        yearEnds: {},
        todayClose: 100,
        noise,
      }),
    ).toThrow(/at least one year-end close/);
  });

  it("refuses a start on or after today", () => {
    expect(() =>
      demoBenchmarkWalk({
        start: "2025-01-02",
        today: "2025-01-02",
        yearEnds: { 2024: 100 },
        todayClose: 100,
        noise,
      }),
    ).toThrow(/needs a start before/);
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
