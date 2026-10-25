import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import {
  benchmarkPrices,
  fxRates,
  portfolioIntradaySnapshots,
  portfolioSnapshots,
  userBenchmarkSymbols,
  users,
} from "@portfolio/db";
import { FixtureProvider, MarketDataService } from "@portfolio/market-data";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { overrideMarketData, invalidateMarketData } from "../../src/services/market-data.js";

// #1031: a `baseCurrency` change leaves `portfolio_snapshots` in two currencies (rows keep
// the currency they were written in). `GET /portfolios/:id/history` converts every row from
// its own currency into the portfolio's current base at that row's date rate before
// chaining the TWR index — never 1:1; a row without a rate is excluded and reported.

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
let privateKey: CryptoKey;

async function token(sub: string) {
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

type HistoryPoint = {
  date: string;
  netWorth: string;
  marketValue: string;
  index: string;
  pct: string;
  benchmarkIndex?: string;
  benchmarkPct?: string;
};

async function userId(sub: string) {
  const [u] = await app.db.select({ id: users.id }).from(users).where(eq(users.authSub, sub));
  return u!.id;
}

/** Create a portfolio in `from`, then switch its base currency to `to` (the #1031 trigger). */
async function portfolioSwitchedBase(t: string, from: string, to: string) {
  const created = await app.inject({
    method: "POST",
    url: "/portfolios",
    headers: auth(t),
    payload: { name: `${from}→${to}`, baseCurrency: from, cashCounted: false },
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().id as string;
  const patched = await app.inject({
    method: "PATCH",
    url: `/portfolios/${id}`,
    headers: auth(t),
    payload: { baseCurrency: to },
  });
  expect(patched.statusCode).toBe(200);
  return id;
}

const snap = (portfolioId: string, date: string, value: string, currency: string) => ({
  portfolioId,
  date,
  netWorth: value,
  marketValue: value,
  effectiveFlow: "0",
  currency,
});

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

describe("per-portfolio history after a baseCurrency change (#1031)", () => {
  let t: string;
  let pf: string;

  beforeAll(async () => {
    t = await token("history-base-change");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    pf = await portfolioSwitchedBase(t, "EUR", "IDR");

    // EUR→IDR moves between the two EUR days, so the date's own rate must be used.
    // USD→IDR for the benchmark, which is converted into the same IDR series.
    await app.db.insert(fxRates).values([
      { base: "EUR", quote: "IDR", rate: "17000", date: "2026-02-02" },
      { base: "EUR", quote: "IDR", rate: "17100", date: "2026-02-03" },
      { base: "USD", quote: "IDR", rate: "16000", date: "2026-02-02" },
      { base: "USD", quote: "IDR", rate: "16000", date: "2026-02-03" },
      { base: "USD", quote: "IDR", rate: "16200", date: "2026-02-04" },
      { base: "USD", quote: "IDR", rate: "16200", date: "2026-02-05" },
    ]);
    // Two EUR rows written before the switch, two IDR rows after it. The value does not
    // move across the switch: 1010 EUR × 17100 = 17,271,000 IDR.
    await app.db
      .insert(portfolioSnapshots)
      .values([
        snap(pf, "2026-02-02", "1000", "EUR"),
        snap(pf, "2026-02-03", "1010", "EUR"),
        snap(pf, "2026-02-04", "17271000", "IDR"),
        snap(pf, "2026-02-05", "17443710", "IDR"),
      ]);

    const uid = await userId("history-base-change");
    await app.db
      .insert(userBenchmarkSymbols)
      .values({ userId: uid, symbol: "^GSPC", displayName: "S&P 500", displayOrder: 0 });
    await app.db.insert(benchmarkPrices).values(
      [
        ["2026-02-02", "4500"],
        ["2026-02-03", "4500"],
        ["2026-02-04", "4500"],
        ["2026-02-05", "4600"],
      ].map(([date, close]) => ({
        userId: uid,
        symbol: "^GSPC",
        date: date!,
        close: close!,
        currency: "USD",
        source: "test",
      })),
    );
  });

  it("returns one series in the current base, with no jump in the index on the switch", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/history?range=all`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-fx-missing-currencies"]).toBeUndefined();
    const body = res.json() as HistoryPoint[];
    expect(body.map((p) => p.date)).toEqual([
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
      "2026-02-05",
    ]);
    // Every row in IDR, each EUR row at its own date's rate.
    expect(body.map((p) => Number(p.netWorth))).toEqual([
      17_000_000, 17_271_000, 17_271_000, 17_443_710,
    ]);
    expect(body.map((p) => Number(p.marketValue))).toEqual([
      17_000_000, 17_271_000, 17_271_000, 17_443_710,
    ]);
    // 17.0M → 17.271M is +1.594% (FX included); the switch day is flat; then +1%.
    expect(Number(body[1]!.index)).toBeCloseTo(101.594118, 4);
    expect(Number(body[2]!.index)).toBeCloseTo(Number(body[1]!.index), 8);
    expect(Number(body[3]!.index)).toBeCloseTo(101.594118 * 1.01, 4);

    // The percentage is the CHAINED one, not a substituted 0 (audit R4-E5): an index of
    // 101.594118 is +1.594118 %. A row whose date has no TWR point carries no percentage
    // at all — never "0", which a base-100 chart would draw as a −100 % cliff.
    expect(Number(body[1]!.pct)).toBeCloseTo(1.594118, 4);
    expect(body[1]!.pct).not.toBe("0");
    expect(body.every((p) => p.index !== undefined && p.pct !== undefined)).toBe(true);

    // Benchmark in the same currency (IDR): 4500 × 16000 → 4600 × 16200 is +3.5%,
    // not the USD-native +2.22%.
    expect(body[0]!.benchmarkPct).toBe("0");
    expect(Number(body[3]!.benchmarkPct)).toBeCloseTo(3.5, 6);
  });

  it("converts the intraday (1D/7D) series into the current base too", async () => {
    const now = Date.now();
    // Each intraday point converts at its capture date's rate (#1038); the older point can
    // fall on yesterday's UTC date shortly after midnight, so both dates carry the rate.
    await app.db
      .insert(fxRates)
      .values(
        [...new Set([toDateKey(new Date(now)), toDateKey(new Date(now - 3_600_000))])].map(
          (date) => ({ base: "EUR", quote: "IDR", rate: "17500", date }),
        ),
      )
      .onConflictDoNothing();
    await app.db.insert(portfolioIntradaySnapshots).values([
      {
        portfolioId: pf,
        capturedAt: new Date(now - 3_600_000),
        netWorth: "1000",
        marketValue: "1000",
        currency: "EUR",
      },
      {
        portfolioId: pf,
        capturedAt: new Date(now - 60_000),
        netWorth: "17500000",
        marketValue: "17500000",
        currency: "IDR",
      },
    ]);
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/history?range=1d`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { netWorth: string; marketValue: string }[];
    expect(body.map((p) => Number(p.netWorth))).toEqual([17_500_000, 17_500_000]);
    expect(body.map((p) => Number(p.marketValue))).toEqual([17_500_000, 17_500_000]);
  });
});

describe("per-portfolio history with no rate for the old base currency (#1031)", () => {
  it("excludes the unrated rows (never 1:1) and reports the currency as missing", async () => {
    const t = await token("history-base-change-nofx");
    await app.inject({ method: "GET", url: "/me", headers: auth(t) });
    // SGD has no rate to IDR anywhere in this file's database.
    const pf = await portfolioSwitchedBase(t, "SGD", "IDR");
    await app.db
      .insert(portfolioSnapshots)
      .values([
        snap(pf, "2026-03-02", "1000", "SGD"),
        snap(pf, "2026-03-03", "1010", "SGD"),
        snap(pf, "2026-03-04", "12000000", "IDR"),
        snap(pf, "2026-03-05", "12120000", "IDR"),
      ]);

    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/history?range=all`,
      headers: auth(t),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-fx-missing-currencies"]).toBe("SGD");
    const body = res.json() as HistoryPoint[];
    expect(body.map((p) => p.date)).toEqual(["2026-03-04", "2026-03-05"]);
    expect(body.map((p) => p.netWorth)).toEqual(["12000000", "12120000"]);
    expect(body[0]!.index).toBe("100");
    expect(Number(body[1]!.index)).toBeCloseTo(101, 8);

    // A cached replay reports the miss too.
    const again = await app.inject({
      method: "GET",
      url: `/portfolios/${pf}/history?range=all`,
      headers: auth(t),
    });
    expect(again.headers["x-fx-missing-currencies"]).toBe("SGD");
  });
});
