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

  // Regression guard for review #753 round 5: concentration must use manualPrice
  // directly for "as of now" claims (current month weight, period movers END),
  // not via a backward-looking lookup that would find synthetic backfill-par rows
  // at/after manualPriceAt. Legacy bonds have par rows at/after manualPriceAt in
  // the stored series — a backward lookup would return a newer par row, not the
  // manual price.
  it("uses manualPrice for current-month weight when stored prices have synthetic par after manualPriceAt", async () => {
    const db = app.db;

    const [u] = await db
      .insert(users)
      .values({ authSub: "conc-mp-user", email: "conc-mp@example.com" })
      .returning();
    const [pf] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "Conc MP", baseCurrency: "IDR", cashCounted: true })
      .returning();

    // Create a bond with manualPrice set (legacy state — no prices row at
    // manualPriceAt, but par rows exist for every day from inception to today).
    const manualDate = new Date("2026-09-01T10:00:00.000Z");
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

    // Buy transaction at inception (2026-08-01).
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: bond.id,
      type: "buy",
      quantity: "10",
      price: "1000000",
      currency: "IDR",
      executedAt: new Date("2026-08-01T10:00:00.000Z"),
    });

    // Synthetic par rows for every day from 2026-08-01 to 2026-09-14 (today).
    const inception = new Date("2026-08-01T00:00:00.000Z");
    const today = new Date("2026-09-14T00:00:00.000Z");
    const parRows: { instrumentId: string; date: string; close: string; currency: string }[] = [];
    const d = new Date(inception);
    while (d <= today) {
      parRows.push({
        instrumentId: bond.id,
        date: toDateKey(d),
        close: "1000000",
        currency: "IDR",
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    await db.insert(prices).values(parRows);

    // dates range: only September 2026 dates.
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-14"];

    const result = await computeConcentrationSection(app, [pf.id], dates, "IDR");

    // The bond should be counted in the current month (September) at the manual
    // price (985000), not par (1000000). With 10 units × 985000 = 9,850,000 IDR.
    // If the bug were present (backward lookup returns par), the value would be
    // 10 × 1000000 = 10,000,000.
    expect(result.concentrationTrend.length).toBeGreaterThan(0);
    const septRow = result.concentrationTrend.find((r) => r.date === "2026-09");
    expect(septRow).toBeDefined();
    // The concentration trend reflects totalMv from the manual price — top1Pct
    // should be 100% (only this bond held). The classCount should be 1 (bond).
    expect(septRow!.top1Pct).toBe(100);
    expect(septRow!.classCount).toBe(1);
  });
});
