import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { closeDb } from "../../src/db/client.js";
import {
  buildIntegrityApp,
  loadLedger,
  expectDecimal,
  type App,
  type LoadedLedger,
} from "./ledger.js";
import { eurBasic, eurBasicExpected } from "./ledgers/eur-basic.js";
import { cashInside, cashInsideExpected } from "./ledgers/cash-inside.js";
import { transfers, transfersExpected } from "./ledgers/transfers.js";
import { split, splitExpected } from "./ledgers/split.js";
import { usdFx, usdFxExpected } from "./ledgers/usd-fx.js";
import { degraded, degradedExpected } from "./ledgers/degraded.js";

// Golden ledgers: fixed-date scenarios, hand-derived expectations (see ledger.ts). The clock is
// frozen at each ledger's `asOf` (Date only, so PGlite/Fastify timers keep running) because route
// handlers call `new Date()` and quotes older than the stale window count as missing.

// 1600/15 is not representable: the average-cost pool carries 20 significant digits, so
// figures derived from it are exact only to ~1e-15 (reported 959.99999999999999998 for 960).
const ROUNDING = "1e-12";

let app: App;
let sign: (sub: string) => Promise<string>;

beforeAll(async () => {
  ({ app, sign } = await buildIntegrityApp());
}, 60_000);

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  await closeDb();
  delete process.env.AUTHENTIK_ISSUER;
  delete process.env.AUTHENTIK_AUDIENCE;
  delete process.env.RATE_LIMIT_MAX;
});

async function get(l: LoadedLedger, url: string) {
  const res = await app.inject({ method: "GET", url, headers: l.headers });
  expect(res.statusCode, url).toBe(200);
  return res.json();
}

describe("eur-basic", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(eurBasic.asOf) });
    l = await loadLedger(app, sign, eurBasic);
  }, 60_000);

  it("summary gain figures match the hand-derived ones", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.depot}/summary`);
    const e = eurBasicExpected;
    expectDecimal(s.gain.value, e.value, "value", ROUNDING);
    expectDecimal(s.gain.costOfOpen, e.costOfOpen, "costOfOpen", ROUNDING);
    expectDecimal(s.gain.unrealized, e.unrealized, "unrealized", ROUNDING);
    expectDecimal(s.gain.realized, e.realized, "realized", ROUNDING);
    expectDecimal(s.gain.income, e.income, "income");
    expect(s.gain.boundary).toBe("outside");
  });

  it("holds the hand-derived share count", async () => {
    const h = await get(l, `/portfolios/${l.portfolioIds.depot}/holdings`);
    expect(h.holdings).toHaveLength(1);
    expectDecimal(h.holdings[0].quantity, eurBasicExpected.openShares, "openShares");
  });

  it("/networth agrees with the single portfolio", async () => {
    const nw = await get(l, "/networth");
    expectDecimal(nw.netWorth, eurBasicExpected.value, "netWorth", ROUNDING);
  });
});

function expectGain(gain: Record<string, string>, e: Record<string, string>, label: string) {
  for (const [k, v] of Object.entries(e)) expectDecimal(gain[k], v, `${label}.${k}`, ROUNDING);
}

describe("cash-inside", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(cashInside.asOf) });
    l = await loadLedger(app, sign, cashInside);
  }, 60_000);

  it("value includes cash; contribution is deposits − withdrawals; interest is return", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.savings}/summary`);
    expect(s.gain.boundary).toBe("inside");
    expectGain(s.gain, cashInsideExpected, "gain");
  });
});

describe("transfers", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(transfers.asOf) });
    l = await loadLedger(app, sign, transfers);
  }, 60_000);

  it("each depot carries the moved shares at carried cost, with no P&L on the transfer", async () => {
    for (const key of ["a", "b"] as const) {
      const s = await get(l, `/portfolios/${l.portfolioIds[key]}/summary`);
      expect(s.gain.boundary).toBe("outside");
      expectGain(s.gain, transfersExpected[key], `gain[${key}]`);
    }
  });

  it("the aggregate is the sum of the depots (a transfer is net zero)", async () => {
    const nw = await get(l, "/networth");
    expectDecimal(nw.netWorth, transfersExpected.all.value, "netWorth", ROUNDING);
    expectGain(nw.gain, transfersExpected.all, "gain[all]");
  });
});

describe("split", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(split.asOf) });
    l = await loadLedger(app, sign, split);
  }, 60_000);

  it("holds split-adjusted shares", async () => {
    const h = await get(l, `/portfolios/${l.portfolioIds.depot}/holdings`);
    expect(h.holdings).toHaveLength(1);
    expectDecimal(h.holdings[0].quantity, splitExpected.openShares, "openShares");
  });

  it("cost of sold shares, realized and contribution use the split-adjusted pool (#823)", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.depot}/summary`);
    expectGain(s.gain, splitExpected.gain, "gain");
  });
});

describe("usd-fx", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(usdFx.asOf) });
    l = await loadLedger(app, sign, usdFx);
  }, 60_000);

  it("values and costs the holding at today's rate, so a flat price shows no gain", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.depot}/summary`);
    expect(s.fxMissingCurrencies).toEqual([]);
    expectDecimal(s.netWorth, usdFxExpected.value, "netWorth", ROUNDING);
    expectGain(s.gain, usdFxExpected, "gain");
  });
});

describe("degraded", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(degraded.asOf) });
    l = await loadLedger(app, sign, degraded);
  }, 60_000);

  it("values an unpriced holding at cost and excludes a holding with no FX rate", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/portfolios/${l.portfolioIds.depot}/summary`,
      headers: l.headers,
    });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.fxMissingCurrencies).toEqual(degradedExpected.fxMissingCurrencies);
    expect(res.headers["x-fx-missing-currencies"]).toContain("CAD");
    expectDecimal(s.netWorth, degradedExpected.netWorth, "netWorth", ROUNDING);

    const byId = new Map<string, Record<string, unknown>>(
      s.holdings.map((h: { instrumentId: string }) => [h.instrumentId, h]),
    );
    expect(byId.get(l.instrumentIds.noq)?.valuedAtCost).toBe(true);
    expect(byId.get(l.instrumentIds.cad)?.fxMissing).toBe(true);
  });
});
