/**
 * A candle carries the provider's own currency, which can differ from the instrument's
 * declared one — a USD-priced UCITS line on Xetra is declared EUR. The backfill must
 * (1) persist the candle's currency, (2) convert it with a real USD→EUR rate when
 * writing snapshots, and (3) when that rate is missing, skip the portfolio and warn
 * (the FX preflight) instead of throwing after the price rows are already committed.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  fxRates,
  instruments,
  portfolios,
  portfolioSnapshots,
  prices,
  transactions,
  users,
} from "@portfolio/db";
import {
  MarketDataService,
  type MarketDataProvider,
  type InstrumentRef,
  type Candle,
} from "@portfolio/market-data";
import { ensureDb, closeDb } from "../../src/db/client.js";
import { backfillPortfolioHistory } from "../../src/services/backfill.js";

const START = "2026-08-01";
const DAYS = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"];

class UsdCandleProvider implements MarketDataProvider {
  readonly name = "usd-candles";

  constructor(private readonly symbol: string) {}

  supports(): boolean {
    return true;
  }
  async getQuote(): Promise<null> {
    return null;
  }
  async getHistoryFrom(ref: InstrumentRef, fromDate: string): Promise<Candle[]> {
    if (ref.symbol !== this.symbol) return [];
    return DAYS.filter((d) => d >= fromDate).map((date) => ({
      date,
      close: "20",
      currency: "USD",
    }));
  }
}

/** An EUR portfolio holding 2 units of an EUR-declared instrument that quotes in USD. */
async function seed(tag: string) {
  const db = await ensureDb();
  const [u] = await db
    .insert(users)
    .values({ authSub: `candle-ccy-${tag}`, email: `candle-ccy-${tag}@example.com` })
    .returning();
  const [pf] = await db
    .insert(portfolios)
    .values({ userId: u.id, name: `Candle Ccy ${tag}`, baseCurrency: "EUR", cashCounted: false })
    .returning();
  const symbol = `CCY${tag.toUpperCase()}`;
  const [instr] = await db
    .insert(instruments)
    .values({
      symbol,
      market: "XETRA",
      assetClass: "etf",
      currency: "EUR",
      name: `Candle currency ${tag}`,
    })
    .returning();
  await db.insert(transactions).values({
    portfolioId: pf.id,
    instrumentId: instr.id,
    type: "buy",
    quantity: "2",
    price: "9",
    fees: "0",
    currency: "EUR",
    executedAt: new Date(`${START}T10:00:00.000Z`),
  });
  return { db, pf, instr, svc: new MarketDataService([new UsdCandleProvider(symbol)]) };
}

describe("backfill — candle currency differs from the instrument's declared currency", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("stores USD prices and values the snapshot as qty × USD close × USD→EUR", async () => {
    const { db, pf, instr, svc } = await seed("fx");
    await db
      .insert(fxRates)
      .values(DAYS.map((date) => ({ base: "USD", quote: "EUR", rate: "0.5", date })));

    await backfillPortfolioHistory(db, svc, 10_000, pf.id);

    const rows = await db.select().from(prices).where(eq(prices.instrumentId, instr.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.currency === "USD")).toBe(true);

    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    const day = snaps.find((s) => s.date === "2026-08-03");
    expect(day, "snapshot for a priced day must exist").toBeDefined();
    // 2 units × 20 USD × 0.5 EUR/USD = 20 EUR (not 40, which a USD-as-EUR label would give).
    expect(Number(day!.marketValue)).toBe(20);
  });

  it("skips the portfolio with a warning when the USD→EUR rate is missing, rather than throwing", async () => {
    const { db, pf, svc } = await seed("nofx");
    // fx_rates is global: drop the rate the previous case seeded.
    await db.delete(fxRates).where(eq(fxRates.base, "USD"));

    await expect(backfillPortfolioHistory(db, svc, 10_000, pf.id)).resolves.toBeDefined();

    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    expect(snaps).toHaveLength(0);
  });
});
