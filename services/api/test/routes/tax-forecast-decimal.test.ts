import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import { dividendEvents, instruments } from "@portfolio/db";
import type { CoreTransaction, PortfolioSummary } from "@portfolio/core";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import { restOfYearForecastGross } from "../../src/routes/transactions/tax-helpers.js";

// Audit B12: the rest-of-year income forecast (fed into the FSA usage estimate) summed
// converted amounts as JS floats. These pin the Decimal version to the old results on
// ordinary fixtures and show the half-cent case where the float sum rounded wrong.

const ISSUER = "https://auth.test/application/o/portfolio/";
const AUDIENCE = "portfolio-tracker";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

const NOW = new Date("2026-06-01T12:00:00.000Z");

async function instrument(symbol: string): Promise<string> {
  const [row] = await app.db
    .insert(instruments)
    .values({ symbol, market: "XETRA", assetClass: "equity", currency: "EUR", name: symbol })
    .returning({ id: instruments.id });
  return row!.id;
}

const summaryOf = (holdings: { instrumentId: string; quantity: string }[]) =>
  ({ holdings }) as unknown as PortfolioSummary;

describe("restOfYearForecastGross — Decimal sums (audit B12)", () => {
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

  it("matches the float result on representative fixtures (gross-up + announced)", async () => {
    const a = await instrument("FCAST-A");
    const b = await instrument("FCAST-B");
    // A: last September paid 8.50 net with 1.50 withheld → projected again this September,
    // grossed up by the trailing ratio (8.5 + 1.5) / 8.5 → 10.00.
    const coreTxns: CoreTransaction[] = [
      {
        id: "div-a",
        instrumentId: a,
        type: "dividend",
        quantity: "0",
        price: "8.5",
        fees: "0",
        tax: "1.5",
        currency: "EUR",
        executedAt: new Date("2025-09-15T00:00:00.000Z"),
      },
    ];
    // B: an announced 0.10/share on 3 shares → 0.30 (floats: 0.30000000000000004).
    await app.db
      .insert(dividendEvents)
      .values({ instrumentId: b, exDate: "2026-09-01", amountPerShare: "0.1", currency: "EUR" });

    const out = await restOfYearForecastGross(
      app,
      coreTxns,
      summaryOf([
        { instrumentId: a, quantity: "10" },
        { instrumentId: b, quantity: "3" },
      ]),
      "EUR",
      2026,
      NOW,
    );
    // Old float path: (8.5 × ((8.5 + 1.5) / 8.5) + 0.1 × 3).toFixed(2) = "10.30".
    expect(out).toBe((8.5 * ((8.5 + 1.5) / 8.5) + 0.1 * 3).toFixed(2));
    expect(out).toBe("10.30");
  });

  it("rounds the exact half-cent the float sum got wrong", async () => {
    const c = await instrument("FCAST-C");
    await app.db
      .insert(dividendEvents)
      .values({ instrumentId: c, exDate: "2026-10-01", amountPerShare: "1.005", currency: "EUR" });
    const out = await restOfYearForecastGross(
      app,
      [],
      summaryOf([{ instrumentId: c, quantity: "1" }]),
      "EUR",
      2026,
      NOW,
    );
    // Float: (1.005).toFixed(2) === "1.00" (1.00499…); the exact value rounds to 1.01.
    expect((1.005).toFixed(2)).toBe("1.00");
    expect(out).toBe("1.01");
  });

  it("is 0 outside the current year", async () => {
    expect(await restOfYearForecastGross(app, [], summaryOf([]), "EUR", 2025, NOW)).toBe("0");
  });
});
