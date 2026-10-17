import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { toDateKey } from "@portfolio/core";
import {
  benchmarkPrices,
  fxRates,
  portfolioIntradaySnapshots,
  portfolioSnapshots,
  userBenchmarkSymbols,
  users,
} from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import type * as FxModule from "../../src/services/fx.js";
import type * as BenchmarkModule from "../../src/services/benchmark.js";

// #1039 (audit A7): a read-scoped PAT must never make a GET fetch from the FX provider or
// persist what it returns. `/networth/history` and `/insights` load their rates through
// `getFxRates`/`getFxRatesForDates` (directly and via the valuation, the per-year flows,
// the benchmark conversion and the concentration trend); record the provider argument
// each call gets — `null` means cached-only, "default" means the configured provider —
// and whether the benchmark prices are back-filled from the market-data provider.
const calls = vi.hoisted(() => ({ fx: [] as { fn: string; provider: unknown }[], ensure: 0 }));
vi.mock("../../src/services/fx.js", async (importOriginal) => {
  const mod = await importOriginal<typeof FxModule>();
  return {
    ...mod,
    getFxRates: (...args: Parameters<typeof mod.getFxRates>) => {
      calls.fx.push({ fn: "getFxRates", provider: args.length >= 5 ? args[4] : "default" });
      return mod.getFxRates(...args);
    },
    getFxRatesForDates: (...args: Parameters<typeof mod.getFxRatesForDates>) => {
      calls.fx.push({
        fn: "getFxRatesForDates",
        provider: args.length >= 5 ? args[4] : "default",
      });
      return mod.getFxRatesForDates(...args);
    },
  };
});
vi.mock("../../src/services/benchmark.js", async (importOriginal) => {
  const mod = await importOriginal<typeof BenchmarkModule>();
  return {
    ...mod,
    ensureBenchmarkPrices: (...args: Parameters<typeof mod.ensureBenchmarkPrices>) => {
      calls.ensure++;
      return mod.ensureBenchmarkPrices(...args);
    },
  };
});

import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function jwt(sub: string) {
  return new SignJWT({ email: `${sub}@example.com` })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  privateKey = kp.privateKey;
  process.env.AUTHENTIK_ISSUER = ISSUER;
  process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey });
  overrideMarketData(new MarketDataService([new FixtureProvider({})]));
});

afterAll(async () => {
  invalidateMarketData();
  await app.close();
  await closeDb();
});

const reset = () => {
  calls.fx.length = 0;
  calls.ensure = 0;
};

describe("FX provider for a read-scoped PAT on /networth/history, /insights and /portfolios/:id/performance (#1039)", () => {
  let owner: string;
  let readPat: string;
  const pfIds: string[] = [];

  beforeAll(async () => {
    const sub = "networth-insights-fx-pat";
    owner = await jwt(sub);
    await app.inject({ method: "GET", url: "/me", headers: auth(owner) });
    const minted = await app.inject({
      method: "POST",
      url: "/me/tokens",
      headers: auth(owner),
      payload: { name: "read", scope: "read" },
    });
    expect(minted.statusCode).toBe(201);
    readPat = minted.json().token as string;

    const [u] = await app.db.select({ id: users.id }).from(users).where(eq(users.authSub, sub));
    const uid = u!.id;
    await app.db.update(users).set({ displayCurrency: "IDR" }).where(eq(users.id, uid));

    // One cash-outside and one cash-inside portfolio, both in EUR, so /insights loads the
    // per-year flows for both boundaries.
    for (const cashCounted of [false, true]) {
      const created = await app.inject({
        method: "POST",
        url: "/portfolios",
        headers: auth(owner),
        payload: { name: `EUR ${cashCounted}`, baseCurrency: "EUR", cashCounted },
      });
      expect(created.statusCode).toBe(201);
      pfIds.push(created.json().id as string);
    }
    for (const pf of pfIds) {
      await app.db.insert(portfolioSnapshots).values(
        ["2026-02-02", "2026-02-03", "2026-02-04"].map((date, i) => ({
          portfolioId: pf,
          date,
          netWorth: String(1000 + i * 10),
          marketValue: String(1000 + i * 10),
          effectiveFlow: "0",
          currency: "EUR",
        })),
      );
      await app.db.insert(portfolioIntradaySnapshots).values({
        portfolioId: pf,
        capturedAt: new Date(Date.now() - 60_000),
        netWorth: "1000",
        marketValue: "1000",
        currency: "EUR",
      });
    }

    // Cached rates for every currency involved, so the rows convert and the benchmark
    // branch is reached; under NODE_ENV=test there is no configured FX provider anyway.
    const fxDates = ["2026-02-02", toDateKey(new Date(Date.now() - 60_000))];
    await app.db.insert(fxRates).values(
      [
        ["EUR", "17000"],
        ["USD", "16000"],
        ["CHF", "18000"],
      ].flatMap(([base, rate]) =>
        fxDates.map((date) => ({ base: base!, quote: "IDR", rate: rate!, date })),
      ),
    );

    // Two benchmarks in different currencies, so the per-year table loads its own rates
    // for the second one instead of reusing the route's.
    await app.db.insert(userBenchmarkSymbols).values([
      { userId: uid, symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 },
      { userId: uid, symbol: "^STOXX50E", displayName: "Euro Stoxx 50", displayOrder: 1 },
    ]);
    await app.db.insert(benchmarkPrices).values(
      [
        ["^GSPC", "USD"],
        ["^STOXX50E", "CHF"],
      ].flatMap(([symbol, currency]) =>
        ["2026-02-02", "2026-02-03", "2026-02-04"].map((date, i) => ({
          userId: uid,
          symbol: symbol!,
          date,
          close: String(4500 + i),
          currency: currency!,
          source: "test",
        })),
      ),
    );
  });

  it.each([
    ["/networth/history?range=all"],
    ["/networth/history?range=7d"],
    ["/networth/history?range=1d"],
    ["/insights?range=all"],
    ["/portfolios/:pf/performance"],
  ])("%s: a read PAT loads every rate cached-only and back-fills no benchmark", async (path) => {
    const url = path.replace(":pf", pfIds[0]!);
    reset();
    const ro = await app.inject({ method: "GET", url, headers: auth(readPat) });
    expect(ro.statusCode).toBe(200);
    expect(calls.fx.length).toBeGreaterThan(0);
    expect(calls.fx.filter((c) => c.provider !== null)).toEqual([]);
    expect(calls.ensure).toBe(0);

    // A session uses the configured provider (argument left to its default). It runs after
    // the read PAT, so it also proves the read PAT's result is cached under its own key.
    reset();
    const rw = await app.inject({ method: "GET", url, headers: auth(owner) });
    expect(rw.statusCode).toBe(200);
    expect(calls.fx.length).toBeGreaterThan(0);
    expect(calls.fx.some((c) => c.provider === null)).toBe(false);
    if (url.includes("range=all")) {
      expect(calls.ensure).toBeGreaterThan(0);
    }
  });
});
