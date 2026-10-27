/**
 * A candle carries the provider's own currency, which can differ from the instrument's
 * declared one — a USD-priced UCITS line on Xetra is declared EUR. The backfill must
 * (1) persist the candle's currency, (2) convert it with a real USD→EUR rate when
 * writing snapshots, and (3) when that rate is missing, exclude just that instrument's
 * prices (valued at cost) and warn, instead of throwing after the price rows are already
 * committed. A missing declared/transaction currency still skips the whole portfolio.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
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

  it("values only the unconvertible instrument at cost when its price currency has no rate", async () => {
    const { db, pf } = await seed("nofx");
    // fx_rates is global: drop the rate the previous case seeded.
    await db.delete(fxRates).where(eq(fxRates.base, "USD"));
    // A second EUR-priced holding in the same portfolio must keep getting snapshots.
    const [eurInstr] = await db
      .insert(instruments)
      .values({
        symbol: "CCYEUR",
        market: "XETRA",
        assetClass: "etf",
        currency: "EUR",
        name: "Candle currency eur",
      })
      .returning();
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: eurInstr.id,
      type: "buy",
      quantity: "1",
      price: "10",
      fees: "0",
      currency: "EUR",
      executedAt: new Date(`${START}T10:00:00.000Z`),
    });
    const eurProvider: MarketDataProvider = {
      name: "eur-candles",
      supports: () => true,
      getQuote: async () => null,
      getHistoryFrom: async (ref, fromDate) =>
        ref.symbol !== "CCYEUR"
          ? []
          : DAYS.filter((d) => d >= fromDate).map((date) => ({
              date,
              close: "12",
              currency: "EUR",
            })),
    };
    const both = new MarketDataService([new UsdCandleProvider("CCYNOFX"), eurProvider]);

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await backfillPortfolioHistory(db, both, 10_000, pf.id);
      const warned = stderr.mock.calls.map((c) => String(c[0])).join("");
      expect(warned).toContain("price rows excluded");
      expect(warned).toContain('"currencies":["USD"]');
    } finally {
      stderr.mockRestore();
    }

    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    const day = snaps.find((s) => s.date === "2026-08-03");
    expect(day, "snapshot must still be written").toBeDefined();
    // EUR holding at market (1 × 12) + the USD-quoting holding at cost (2 × 9).
    expect(Number(day!.marketValue)).toBe(30);
  });

  it("keeps the convertible rows of a mixed-currency series and survives a re-run", async () => {
    const { db, pf, instr } = await seed("mixed");
    await db.delete(fxRates).where(eq(fxRates.base, "USD"));
    await db.delete(fxRates).where(eq(fxRates.base, "SGD"));
    await db.insert(fxRates).values(
      ["2026-08-01", "2026-08-02"].map((date) => ({
        base: "USD",
        quote: "EUR",
        rate: "0.5",
        date,
      })),
    );
    // USD rows on 08-01/02 convert; SGD rows on 08-03/04 have no rate at all.
    const mixed = new Map([
      ["2026-08-01", { close: "20", currency: "USD" }],
      ["2026-08-02", { close: "20", currency: "USD" }],
      ["2026-08-03", { close: "20", currency: "SGD" }],
      ["2026-08-04", { close: "20", currency: "SGD" }],
    ]);
    await db
      .insert(prices)
      .values([...mixed].map(([date, p]) => ({ instrumentId: instr.id, date, ...p })));
    const empty = new MarketDataService([]);

    for (let run = 0; run < 2; run++) {
      await backfillPortfolioHistory(db, empty, 10_000, pf.id);
      const snaps = await db
        .select()
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.portfolioId, pf.id));
      // 2 units × 20 USD × 0.5 = 20 EUR at market, not the cost of 18.
      expect(Number(snaps.find((s) => s.date === "2026-08-01")!.marketValue), `run ${run}`).toBe(
        20,
      );
    }
  });

  it("still skips the portfolio when a transaction currency has no rate", async () => {
    const { db, pf, instr, svc } = await seed("txfx");
    await db.insert(transactions).values({
      portfolioId: pf.id,
      instrumentId: instr.id,
      type: "buy",
      quantity: "1",
      price: "10",
      fees: "0",
      currency: "GBP",
      executedAt: new Date(`${START}T11:00:00.000Z`),
    });
    await db.delete(fxRates).where(eq(fxRates.base, "GBP"));

    await expect(backfillPortfolioHistory(db, svc, 10_000, pf.id)).resolves.toBeDefined();

    const snaps = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, pf.id));
    expect(snaps).toHaveLength(0);
  });
});
