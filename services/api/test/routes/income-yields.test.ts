import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import { summarizePortfolio, type CoreTransaction } from "@portfolio/core";
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
    // A real, complete summary (both holdings priced, value 1000 and cost 800 each), then one
    // holding's display cost nulled. A value without a cost is not reachable from the route today
    // (a no-rate holding has neither), which is exactly why the filter clause is easy to delete
    // unnoticed. Typed end to end: `costBasisDisplay` is nullable, so no cast is needed.
    const buy = (instrumentId: string): CoreTransaction => ({
      instrumentId,
      type: "buy",
      quantity: "10",
      price: "80",
      fees: "0",
      currency: "EUR",
      executedAt: new Date("2025-01-10T10:00:00.000Z"),
    });
    const priced = summarizePortfolio({
      transactions: [buy(withCost.id), buy(noCost.id)],
      prices: {
        [withCost.id]: { price: "100", currency: "EUR" },
        [noCost.id]: { price: "100", currency: "EUR" },
      },
      displayCurrency: "EUR",
      fx: (from, to) => (from === to ? "1" : null),
    });
    const summary = {
      ...priced,
      holdings: priced.holdings.map((h) =>
        h.instrumentId === noCost.id ? { ...h, costBasisDisplay: null } : h,
      ),
    };

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
