import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import { instruments, portfolios, prices, transactions, users } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { computeConcentrationSection } from "../../src/routes/transactions/insights/concentration.js";

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

describe("computeConcentrationSection with manualPrice", () => {
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256");
    process.env.AUTHENTIK_ISSUER = ISSUER;
    process.env.AUTHENTIK_AUDIENCE = AUDIENCE;
    process.env.RATE_LIMIT_MAX = "10000";
    app = await buildApp({ authKey: kp.publicKey });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.AUTHENTIK_ISSUER;
    delete process.env.AUTHENTIK_AUDIENCE;
    delete process.env.RATE_LIMIT_MAX;
  });

  // Regression guard for review #753 round 5/6: concentration must use manualPrice
  // directly for "as of now" claims (current month weight, period movers END),
  // not via a backward-looking lookup that would find synthetic backfill-par rows
  // at/after manualPriceAt. Legacy bonds have par rows at/after manualPriceAt in
  // the stored series — a backward lookup would return a newer par row, not the
  // manual price.
  //
  // Discriminating setup: TWO holdings — a manual-priced bond AND an equity at a
  // price equal to par. With the bond at manual price (985000), the bond weight
  // fraction = 9,850,000 / (9,850,000 + 10,000,000) = 0.4962 (top1Pct = 49.62).
  // If the bug were present (backward lookup returns par 1000000), the fraction
  // = 10,000,000 / 20,000,000 = 0.5000 (top1Pct = 50.00). The 0.38 pp gap is
  // detectable after rounding.
  it("uses manualPrice for current-month weight (discriminating vs second holding)", async () => {
    const db = app.db;

    const [u] = await db
      .insert(users)
      .values({ authSub: "conc-mp-user", email: "conc-mp@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Conc MP", baseCurrency: "IDR", cashCounted: true })
      .returning();

    // Bond with manualPrice set (legacy state — no prices row at manualPriceAt,
    // but par rows exist for every day from inception to today).
    const manualDate = new Date("2026-09-10T10:00:00.000Z");
    const [bond] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "SR021T3-CONC",
        name: "SR021T3 concentration test",
        faceValue: "1000000",
        manualPrice: "985000",
        manualPriceAt: manualDate,
      })
      .returning();

    // Second holding: an equity at a price equal to par, so the weight ratio
    // shifts detectably between manual price (985000) and par (1000000).
    const [equity] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        symbol: "BBCA-CONC",
        name: "BCA equity — concentration test",
      })
      .returning();

    // Buy transactions at inception.
    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: bond.id,
        type: "buy",
        quantity: "10", // 10 × 985000 = 9,850,000 (manual) or 10 × 1000000 = 10,000,000 (par)
        price: "1000000",
        currency: "IDR",
        executedAt: new Date("2026-08-01T10:00:00.000Z"),
      },
      {
        portfolioId: pf.id,
        instrumentId: equity.id,
        type: "buy",
        quantity: "100", // 100 × 100000 = 10,000,000
        price: "100000",
        currency: "IDR",
        executedAt: new Date("2026-08-01T10:00:00.000Z"),
      },
    ]);

    // Synthetic par rows for the bond (every day from inception to today).
    const inception = new Date("2026-08-01T00:00:00.000Z");
    const today = new Date("2026-09-14T00:00:00.000Z");
    const bondParRows: { instrumentId: string; date: string; close: string; currency: string }[] =
      [];
    {
      const d = new Date(inception);
      while (d <= today) {
        bondParRows.push({
          instrumentId: bond.id,
          date: toDateKey(d),
          close: "1000000",
          currency: "IDR",
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    // Live provider rows for the equity (every day from inception to today).
    const equityRows: { instrumentId: string; date: string; close: string; currency: string }[] =
      [];
    {
      const d = new Date(inception);
      while (d <= today) {
        equityRows.push({
          instrumentId: equity.id,
          date: toDateKey(d),
          close: "100000",
          currency: "IDR",
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    await db.insert(prices).values([...bondParRows, ...equityRows]);

    // dates range: only September 2026 dates.
    const dates = ["2026-09-01", "2026-09-02", "2026-09-10", "2026-09-11", "2026-09-14"];

    const result = await computeConcentrationSection(app, [pf.id], dates, "IDR");

    expect(result.concentrationTrend.length).toBeGreaterThan(0);
    const septRow = result.concentrationTrend.find((r) => r.date === "2026-09");
    expect(septRow).toBeDefined();
    expect(septRow!.classCount).toBe(2);

    // Bond at manual price (985000): bond_mv = 9,850,000; equity_mv = 10,000,000.
    // top1Pct = max(9,850,000, 10,000,000) / (9,850,000 + 10,000,000) = 10,000,000 / 19,850,000 = 50.38%.
    // HHI = (9,850,000/19,850,000)^2 + (10,000,000/19,850,000)^2 ≈ 0.4962^2 + 0.5038^2 = 0.2462 + 0.2538 = 0.5000.
    //
    // If the bug were present (bond at par 1000000): bond_mv = 10,000,000;
    // top1Pct = 10,000,000 / 20,000,000 = 50.00%. HHI = 0.5^2 + 0.5^2 = 0.5000.
    //
    // The bond weight fraction differs (9,850,000 vs 10,000,000 numerator), so
    // top1Pct differs: 50.38% vs 50.00%.
    expect(septRow!.top1Pct).toBe(50.38);
  });

  // Regression guard for the END-price path in bestWorstMonthly — also changed
  // in round 5 to prefer manualPrice directly over the backward lookup.
  //
  // Discriminating setup: bond held at both monthStart (2026-09-01) and latestDate
  // (2026-09-14). Manual price (985000) set on 2026-09-10 — a par row exists at
  // 2026-09-14 (the latestDate). With the fix, END price = manualPrice (985000);
  // without the fix, END price = par (1000000).
  //
  // priceStart = par at 2026-09-01 = 1000000 (no manual override for START).
  // If END = manualPrice 985000: pct = 985000/1000000 - 1 = -1.50%.
  // If END = par 1000000: pct = 1000000/1000000 - 1 = 0.00%.
  //
  // A second holding (stable equity) is required so the ranking produces 2 movers;
  // computePeriodMovers returns null {best, worst} when movers.length < 2.
  it("uses manualPrice for bestWorstMonthly END price (discriminating vs par)", async () => {
    const db = app.db;

    const [u] = await db
      .insert(users)
      .values({ authSub: "mover-mp-user", email: "mover-mp@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Mover MP", baseCurrency: "IDR", cashCounted: true })
      .returning();

    const manualDate = new Date("2026-09-10T10:00:00.000Z");
    const [bond] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "bond",
        unit: "units",
        currency: "IDR",
        symbol: "SR021T3-MOVER",
        name: "SR021T3 mover test",
        faceValue: "1000000",
        manualPrice: "985000",
        manualPriceAt: manualDate,
      })
      .returning();

    // Stable second holding — flat price 100000 → pct = 0 → moves vs the bond's
    // -1.5% gives a non-tie ranking.
    const [equity] = await db
      .insert(instruments)
      .values({
        market: "IDX",
        assetClass: "equity",
        unit: "shares",
        currency: "IDR",
        symbol: "BMRI-MOVER",
        name: "BMRI equity — mover test",
      })
      .returning();

    await db.insert(transactions).values([
      {
        portfolioId: pf.id,
        instrumentId: bond.id,
        type: "buy",
        quantity: "1",
        price: "1000000",
        currency: "IDR",
        executedAt: new Date("2026-08-15T10:00:00.000Z"), // held before monthStart
      },
      {
        portfolioId: pf.id,
        instrumentId: equity.id,
        type: "buy",
        quantity: "1",
        price: "100000",
        currency: "IDR",
        executedAt: new Date("2026-08-15T10:00:00.000Z"),
      },
    ]);

    // Synthetic par rows for the bond (every day from inception to today).
    const startDate = new Date("2026-08-15T00:00:00.000Z");
    const today = new Date("2026-09-14T00:00:00.000Z");
    const bondParRows: { instrumentId: string; date: string; close: string; currency: string }[] =
      [];
    {
      const d = new Date(startDate);
      while (d <= today) {
        bondParRows.push({
          instrumentId: bond.id,
          date: toDateKey(d),
          close: "1000000",
          currency: "IDR",
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    // Flat equity rows (stable price 100000).
    const equityRows: { instrumentId: string; date: string; close: string; currency: string }[] =
      [];
    {
      const d = new Date(startDate);
      while (d <= today) {
        equityRows.push({
          instrumentId: equity.id,
          date: toDateKey(d),
          close: "100000",
          currency: "IDR",
        });
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    await db.insert(prices).values([...bondParRows, ...equityRows]);

    const dates = ["2026-09-01", "2026-09-02", "2026-09-10", "2026-09-11", "2026-09-14"];

    const result = await computeConcentrationSection(app, [pf.id], dates, "IDR");

    // Bond: priceStart = par 1000000, priceEnd = manualPrice 985000 → pct = -1.50%.
    // Equity: priceStart = 100000, priceEnd = 100000 → pct = 0%.
    // Worst = bond (-1.50%), Best = equity (0%).
    expect(result.bestWorstMonthly.best).not.toBeNull();
    expect(result.bestWorstMonthly.worst).not.toBeNull();
    expect(result.bestWorstMonthly.best!.pct).toBeCloseTo(0, 3);
    expect(result.bestWorstMonthly.best!.symbol).toBe("BMRI-MOVER");
    expect(result.bestWorstMonthly.worst!.pct).toBeCloseTo(-0.015, 3);
    expect(result.bestWorstMonthly.worst!.symbol).toBe("SR021T3-MOVER");
  });
});
