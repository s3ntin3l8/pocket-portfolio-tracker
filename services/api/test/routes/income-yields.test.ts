import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import type { CoreTransaction, PortfolioSummary } from "@portfolio/core";
import { instruments } from "@portfolio/db";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { buildIncomeStats } from "../../src/routes/transactions/income-helpers.js";

// The yields table needs a market value AND a cost. The filter that guarantees both is a type
// predicate, which TypeScript asserts but does not check: this pins the behaviour, so dropping
// the null-cost clause later cannot slip through as a type that still compiles.

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const kp = await generateKeyPair("ES256");
  process.env.RATE_LIMIT_MAX = "10000";
  app = await buildApp({ authKey: kp.publicKey });
});
afterAll(async () => {
  await app.close();
  await closeDb();
  delete process.env.RATE_LIMIT_MAX;
});

const holding = (instrumentId: string, over: Record<string, unknown> = {}) => ({
  instrumentId,
  quantity: "10",
  marketValueDisplay: "1000",
  costBasisDisplay: "800",
  ...over,
});

describe("buildIncomeStats yields", () => {
  it("lists a holding with a market value and a cost, and leaves out one with no display cost", async () => {
    const mk = async (symbol: string) =>
      (
        await app.db
          .insert(instruments)
          .values({
            symbol,
            market: "XETRA",
            assetClass: "equity",
            currency: "EUR",
            name: symbol,
          })
          .returning()
      )[0]!;
    const withCost = await mk("YLD-COST");
    const noCost = await mk("YLD-NOCOST");

    const recent = new Date(Date.now() - 30 * 86_400_000);
    const dividend = (instrumentId: string): CoreTransaction => ({
      instrumentId,
      type: "dividend",
      quantity: "0",
      price: "20",
      fees: "0",
      currency: "EUR",
      executedAt: recent,
    });
    const summary = {
      holdings: [
        holding(withCost.id),
        // A value but no cost: not reachable from the route today (a no-rate holding has neither),
        // which is exactly why the clause is easy to delete unnoticed.
        holding(noCost.id, { costBasisDisplay: null }),
      ],
    } as unknown as PortfolioSummary;

    const stats = await buildIncomeStats(
      app,
      [dividend(withCost.id), dividend(noCost.id)],
      summary,
      "EUR",
    );

    expect(stats.yields.map((y) => y.instrumentId)).toEqual([withCost.id]);
    // 20 trailing / 1000 value, and 20 / 800 cost.
    expect(Number(stats.yields[0]!.yield)).toBeCloseTo(0.02, 10);
    expect(Number(stats.yields[0]!.yieldOnCost)).toBeCloseTo(0.025, 10);
  });
});
