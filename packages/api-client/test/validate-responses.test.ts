import { describe, it, expect, vi } from "vitest";
import { createApiClient, ApiError } from "../src/index.js";

const holding = {
  instrumentId: "i1",
  quantity: "10",
  avgCost: "100",
  costBasis: "1000",
  realizedPnL: "0",
  costCurrency: "EUR",
  price: "110",
  currency: "EUR",
  marketValue: "1100",
  unrealizedPnL: "100",
  marketValueDisplay: "1100",
  costBasisDisplay: "1000",
  unrealizedPnLDisplay: "100",
  previousClose: null,
  dayChange: null,
  dayChangePct: null,
  instrument: null,
};

const valuation = {
  displayCurrency: "EUR",
  holdings: [holding],
  cash: {},
  cashTracked: false,
  cashDisplay: {},
  netWorth: "1100",
  totalCost: "1000",
  totalMarketValue: "1100",
  totalUnrealizedPnL: "100",
  totalRealizedPnL: "0",
  totalLiabilities: "0",
  totalIncome: "0",
  totalDayChange: "0",
  exposureByCurrency: { EUR: "1100" },
  fxMissingCurrencies: [],
  gain: {
    displayCurrency: "EUR",
    boundary: "outside",
    value: "1100",
    costOfOpen: "1000",
    netContributed: "1000",
    unrealized: "100",
    realized: "0",
    income: "0",
  },
};

const networth = { ...valuation, xirr: null, portfolioCount: 1, asOf: "2026-10-13T00:00:00.000Z" };

function clientFor(body: unknown, validateResponses?: boolean) {
  const fetchImpl = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as Response,
  );
  return createApiClient({
    baseUrl: "http://api.test",
    fetch: fetchImpl as unknown as typeof fetch,
    validateResponses,
  });
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a rejection");
}

describe("validateResponses", () => {
  it("passes a well-formed /networth and returns the body untouched", async () => {
    const c = clientFor(networth, true);
    await expect(c.getNetWorth()).resolves.toBe(networth);
  });

  it("accepts Decimal.js exponent notation in money strings", async () => {
    const c = clientFor({ ...networth, totalDayChange: "1e-8" }, true);
    await expect(c.getNetWorth()).resolves.toMatchObject({ totalDayChange: "1e-8" });
  });

  it("rejects a /networth missing fxMissingCurrencies as invalid_response", async () => {
    const { fxMissingCurrencies: _drop, ...bad } = networth;
    const err = await rejection(clientFor(bad, true).getNetWorth());
    expect(err).toBeInstanceOf(ApiError);
    expect(err.body).toMatch(/^invalid_response: \/networth — fxMissingCurrencies/);
  });

  it("rejects a numeric money field", async () => {
    const err = await rejection(clientFor({ ...networth, netWorth: 1100 }, true).getNetWorth());
    expect(err.body).toMatch(/invalid_response/);
    expect(err.body).toMatch(/netWorth/);
  });

  it("validates the portfolio summary", async () => {
    await expect(clientFor(valuation, true).getSummary("p1")).resolves.toBeTruthy();
    const err = await rejection(clientFor({ ...valuation, holdings: "x" }, true).getSummary("p1"));
    expect(err.body).toMatch(/invalid_response: \/portfolios\/:id\/summary — holdings/);
  });

  it("validates both paginated transaction lists", async () => {
    await expect(
      clientFor({ rows: [], total: 0 }, true).listNetworthTransactionsPaginated(1),
    ).resolves.toEqual({ rows: [], total: 0 });
    const err = await rejection(
      clientFor({ rows: [], total: "0" }, true).listTransactionsPaginated("p1", 1),
    );
    expect(err.body).toMatch(/invalid_response: \/portfolios\/:id\/transactions — total/);
    const err2 = await rejection(
      clientFor({ total: 0 }, true).listNetworthTransactionsPaginated(1),
    );
    expect(err2.body).toMatch(/\/networth\/transactions — rows/);
  });

  it("does nothing when validation is off (the default)", async () => {
    const bad = { not: "a networth" };
    await expect(clientFor(bad).getNetWorth()).resolves.toBe(bad);
    await expect(clientFor(bad, false).getSummary("p1")).resolves.toBe(bad);
  });
});
