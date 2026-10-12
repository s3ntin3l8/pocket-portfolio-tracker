/**
 * Audit B2 — the historical backfill never writes a 1:1-converted snapshot. A currency
 * with no FX rate at all (none cached, no provider under test) skips the run's writes
 * (existing snapshots stay) instead of failing or converting 1:1; once a rate exists the
 * same run writes normally.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
import { toDateKey } from "@portfolio/core";
import { ensureDb, getDb, closeDb } from "../../src/db/client.js";
import { computeBackfillSnapshots } from "../../src/services/backfill.js";

const daysAgo = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return toDateKey(d);
};

describe("backfill — missing FX rate (audit B2)", () => {
  let portfolioId: string;

  beforeAll(async () => {
    const db = await ensureDb();
    const [u] = await db
      .insert(users)
      .values({ authSub: "bf-fx-user", email: "bf-fx@example.com" })
      .returning();
    const [p] = await db
      .insert(portfolios)
      .values({ userId: u.id, name: "BF FX", baseCurrency: "IDR", cashCounted: false })
      .returning();
    portfolioId = p.id;
    const [inst] = await db
      .insert(instruments)
      .values({
        symbol: "BFFXEUR",
        market: "XETRA",
        assetClass: "equity",
        currency: "EUR",
        name: "EUR stock",
      })
      .returning();
    await db.insert(transactions).values({
      portfolioId,
      instrumentId: inst.id,
      type: "buy",
      quantity: "10",
      price: "100",
      currency: "EUR",
      executedAt: new Date(`${daysAgo(3)}T09:00:00.000Z`),
    });
    for (const n of [3, 2, 1, 0]) {
      await db
        .insert(prices)
        .values({ instrumentId: inst.id, date: daysAgo(n), close: "100", currency: "EUR" });
    }
  });

  afterAll(async () => {
    await closeDb();
  });

  const rows = () =>
    getDb()
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.portfolioId, portfolioId));

  it("writes nothing (no 1:1 values) while EUR→IDR has no rate", async () => {
    const res = await computeBackfillSnapshots(getDb(), portfolioId);
    expect(res.days).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("writes the converted series once a rate exists", async () => {
    await getDb()
      .insert(fxRates)
      .values({ base: "EUR", quote: "IDR", rate: "17000", date: daysAgo(3) });
    const res = await computeBackfillSnapshots(getDb(), portfolioId);
    expect(res.days).toBeGreaterThan(0);
    const written = await rows();
    expect(written.length).toBeGreaterThan(0);
    // 10 × 100 EUR × 17,000 — never 1,000 (EUR counted as IDR).
    expect(written.every((r) => Number(r.marketValue) === 17_000_000)).toBe(true);
  });
});
