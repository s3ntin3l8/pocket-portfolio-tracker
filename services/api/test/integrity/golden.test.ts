import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Decimal } from "decimal.js";
import { eq } from "drizzle-orm";
import { corporateActions } from "@portfolio/db";
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
import { deTax, deTaxExpected } from "./ledgers/de-tax.js";
import { deTaxPots, deTaxPotsExpected } from "./ledgers/de-tax-pots.js";
import { history, historyExpected } from "./ledgers/history.js";
import { merger, mergerExpected } from "./ledgers/merger.js";
import { mixedBoundary, mixedBoundaryExpected } from "./ledgers/mixed-boundary.js";
import { deTaxSlice, deTaxSliceExpected } from "./ledgers/de-tax-slice.js";
import { anomalies, anomaliesExpected } from "./ledgers/anomalies.js";
import { metaBase, metaBaseExpected } from "./ledgers/meta-base.js";
import { multiBase, multiBaseExpected } from "./ledgers/multi-base.js";
import { fxCarry, fxCarryExpected, fxStale, fxStaleExpected } from "./ledgers/fx-carry.js";

// Golden ledgers: fixed-date scenarios, hand-derived expectations (see ledger.ts). The clock is
// frozen at each ledger's `asOf` (Date only, so PGlite/Fastify timers keep running) because route
// handlers call `new Date()` and quotes older than the stale window count as missing.

// The average-cost pool carries 20 significant digits, so figures derived from it are exact only
// to ~1e-15 (959.99999999999999998 for 960). Deliberate; see "Average-cost precision" in
// docs/integrity.md (#1159).
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
    expect(nw.gain.boundary).toBe("outside");
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
    expect(s.gain.boundary).toBe("outside");
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
    for (const [k, v] of Object.entries(degradedExpected.totals)) {
      expectDecimal(s[k], v, k, ROUNDING);
    }

    const byId = new Map<string, Record<string, unknown>>(
      s.holdings.map((h: { instrumentId: string }) => [h.instrumentId, h]),
    );
    expect(byId.get(l.instrumentIds.noq)?.valuedAtCost).toBe(true);
    expect(byId.get(l.instrumentIds.cad)?.fxMissing).toBe(true);
    // No display-currency cost for a holding with no rate (#1161): not the native 30 CAD, which
    // used to be summed into display-currency cost totals. The at-cost EUR holding still has one.
    expect(byId.get(l.instrumentIds.cad)?.costBasisDisplay).toBeNull();
    expect(byId.get(l.instrumentIds.noq)?.costBasisDisplay).toBe("100");
  });
});

describe.each([
  ["fx-carry (rate 5 days old: carried forward)", fxCarry, fxCarryExpected],
  ["fx-stale (rate 15 days old: missing, never today's)", fxStale, fxStaleExpected],
])("%s", (_name, ledger, expected) => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(ledger.asOf) });
    l = await loadLedger(app, sign, ledger);
  }, 60_000);

  it("converts only with a rate inside the carry-forward window", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.depot}/summary`);
    expect(s.fxMissingCurrencies).toEqual(expected.fxMissingCurrencies);
    expectDecimal(s.netWorth, expected.netWorth, "netWorth", ROUNDING);
  });
});

describe("multi-base", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(multiBase.asOf) });
    l = await loadLedger(app, sign, multiBase);
  }, 60_000);

  it("summarises each depot in its own base currency", async () => {
    const eu = await get(l, `/portfolios/${l.portfolioIds.eu}/summary`);
    const se = await get(l, `/portfolios/${l.portfolioIds.se}/summary`);
    expect(eu.displayCurrency).toBe("EUR");
    expect(se.displayCurrency).toBe("SEK");
    expectDecimal(eu.netWorth, multiBaseExpected.euSummary, "eu.netWorth", ROUNDING);
    expectDecimal(se.netWorth, multiBaseExpected.seSummarySek, "se.netWorth", ROUNDING);
  });

  it("/networth converts the SEK depot at today's rate into the display currency", async () => {
    const nw = await get(l, "/networth");
    expect(nw.displayCurrency).toBe("EUR");
    expectDecimal(nw.netWorth, multiBaseExpected.networth, "netWorth", ROUNDING);
  });
});

describe("meta-base", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(metaBase.asOf) });
    l = await loadLedger(app, sign, metaBase);
  }, 60_000);

  it("matches the hand-derived figures the metamorphic relations start from", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.a}/summary`);
    expect(s.gain.boundary).toBe("outside");
    expectGain(s.gain, metaBaseExpected, "gain");
  });
});

describe("anomalies", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(anomalies.asOf) });
    l = await loadLedger(app, sign, anomalies);
  }, 60_000);

  it("flags the oversell and the zero-price trade, per depot and in the aggregate", async () => {
    const codes = async (url: string) =>
      ((await get(l, url)).anomalies as { code: string }[]).map((a) => a.code).sort();
    expect(await codes(`/portfolios/${l.portfolioIds.a}/anomalies`)).toEqual(anomaliesExpected.a);
    expect(await codes(`/portfolios/${l.portfolioIds.b}/anomalies`)).toEqual(anomaliesExpected.b);
    expect(await codes("/networth/anomalies")).toEqual(
      [...anomaliesExpected.a, ...anomaliesExpected.b].sort(),
    );
  });
});

// The route reports the tax to the cent; the hand-derived tax (e.g. 92.3125) is compared to
// within half a cent. Every other figure here is exact, so a sub-cent engine error is visible.
const CENT = "0.005";

describe.each([
  ["de-tax: both pots positive, taxable above the allowance", deTax, deTaxExpected],
  ["de-tax-pots: a stock loss is not netted against general income", deTaxPots, deTaxPotsExpected],
])("%s", (_name, ledger, e) => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(ledger.asOf) });
    l = await loadLedger(app, sign, ledger);
  }, 60_000);

  it("splits the pots, applies the allowance and taxes the excess", async () => {
    const t = await get(l, `/portfolios/${l.portfolioIds.depot}/tax?year=${e.year}`);
    const u = t.allowanceUsage;
    expect(t.regime).toBe("DE");
    expect(u.taxRate).toBe("0.26375");
    expectDecimal(u.stockPot.netGainLoss, e.stockPot, "stockPot");
    expectDecimal(u.generalPot.netGainLoss, e.generalPot, "generalPot");
    expectDecimal(u.usedYtd, e.allowanceUsed, "usedYtd");
    expectDecimal(u.taxableExcess, e.taxableExcess, "taxableExcess");
    expectDecimal(u.estimatedTax, e.estimatedTax, "estimatedTax", CENT);
    expectDecimal(u.remaining, "0", "remaining");
    expectDecimal(
      new Decimal(u.usedYtd).add(u.taxableExcess),
      e.taxableBeforeAllowance,
      "usedYtd + taxableExcess = pots counted",
    );
  });
});

describe("de-tax-slice: the depot's slice, not the holder's cap, is the allowance", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(deTaxSlice.asOf) });
    l = await loadLedger(app, sign, deTaxSlice);
  }, 60_000);

  it("nets against the 400 slice and taxes the excess at the holder's explicit rate", async () => {
    const e = deTaxSliceExpected;
    const t = await get(l, `/portfolios/${l.portfolioIds.depot}/tax?year=${e.year}`);
    const u = t.allowanceUsage;
    expect(u.taxRate).toBe(e.taxRate);
    expectDecimal(u.allowanceAnnual, e.allowanceAnnual, "allowanceAnnual");
    expectDecimal(u.stockPot.netGainLoss, e.stockPot, "stockPot");
    expectDecimal(u.usedYtd, e.allowanceUsed, "usedYtd");
    expectDecimal(u.taxableExcess, e.taxableExcess, "taxableExcess");
    expectDecimal(u.estimatedTax, e.estimatedTax, "estimatedTax", CENT);
  });

  it("warns that the slices (400 + 800) exceed the holder's cap (1000), without changing the tax", async () => {
    const e = deTaxSliceExpected;
    const t = await get(l, `/portfolios/${l.portfolioIds.depot}/tax?year=${e.year}`);
    expectDecimal(t.holderDistribution.holderAllowanceCap, e.holderAllowanceCap, "cap");
    expectDecimal(t.holderDistribution.totalAllocated, e.totalAllocated, "totalAllocated");
    expect(t.holderDistribution.overAllocated).toBe(true);
  });
});

describe("merger", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(merger.asOf) });
    l = await loadLedger(app, sign, merger);
  }, 60_000);

  // First on purpose: derivations are cached per request key, so a later test could be served
  // a cached result and never re-run the engine path whose stderr this watches.
  it("agrees with its corporate-action row: the pair's proceeds and basis equal the taxable market value", async () => {
    // The engine cross-checks a pre-priced pair against the merger row's `taxableMarketValue` and
    // writes a structured warning to stderr on a mismatch (it never fails the request). A
    // consistent ledger must stay silent; with the row at a wrong value this emits warnings.
    // Guard the premise: the cross-check below is only meaningful if the row is really there.
    const rows = await app.db
      .select()
      .from(corporateActions)
      .where(eq(corporateActions.instrumentId, l.instrumentIds.a!));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "merger",
      targetInstrumentId: l.instrumentIds.b,
      portfolioId: l.portfolioIds.depot,
      taxableMarketValue: "1500",
    });

    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as never);
    try {
      for (const view of ["summary", "holdings", "trades"]) {
        await get(l, `/portfolios/${l.portfolioIds.depot}/${view}`);
      }
    } finally {
      spy.mockRestore();
    }
    expect(writes.filter((w) => w.includes("merger_importer"))).toEqual([]);
  });

  it("realizes the step-up on the sale leg, carries the new basis, and stays contribution-neutral", async () => {
    const s = await get(l, `/portfolios/${l.portfolioIds.depot}/summary`);
    expect(s.gain.boundary).toBe("outside");
    expectGain(s.gain, mergerExpected, "gain");
  });

  it("opens the new fund and leaves the old one closed with the realized step-up", async () => {
    const h = await get(l, `/portfolios/${l.portfolioIds.depot}/holdings`);
    const by = new Map<string, { quantity: string; realizedPnL: string }>(
      h.holdings.map((x: { instrumentId: string; quantity: string; realizedPnL: string }) => [
        x.instrumentId,
        x,
      ]),
    );
    expectDecimal(by.get(l.instrumentIds.b!)!.quantity, "20", "FUNDB quantity");
    // The closed position stays listed (it carries the realized P&L): 10 × 150 − 1,000 = 500.
    expectDecimal(by.get(l.instrumentIds.a!)!.quantity, "0", "FUNDA quantity");
    expectDecimal(by.get(l.instrumentIds.a!)!.realizedPnL, "500", "FUNDA realized");
  });
});

describe("mixed-boundary", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(mixedBoundary.asOf) });
    l = await loadLedger(app, sign, mixedBoundary);
  }, 60_000);

  it("keeps each portfolio on its own boundary", async () => {
    for (const key of ["savings", "depot"] as const) {
      const { boundary, ...figures } = mixedBoundaryExpected[key];
      const s = await get(l, `/portfolios/${l.portfolioIds[key]}/summary`);
      expect(s.gain.boundary, `${key} boundary`).toBe(boundary);
      expectGain(s.gain, figures, `gain[${key}]`);
    }
  });

  it("sums the same-boundary pairs and reports the aggregate as mixed", async () => {
    const { boundary, ...figures } = mixedBoundaryExpected.all;
    const nw = await get(l, "/networth");
    expect(nw.gain.boundary).toBe(boundary);
    expectGain(nw.gain, figures, "gain[all]");
    expectDecimal(nw.netWorth, figures.value, "netWorth", ROUNDING);
  });
});

describe("history", () => {
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(history.asOf) });
    l = await loadLedger(app, sign, history);
  }, 60_000);

  const points = (body: { date: string; netWorth: string; marketValue: string }[]) =>
    body.map((p) => ({ date: p.date, netWorth: p.netWorth, marketValue: p.marketValue }));

  it("the aggregate netWorth sums each date's snapshots; a portfolio counts only where it has one, and a hole is not filled", async () => {
    const agg = points(await get(l, "/networth/history?range=all"));
    expect(agg.map((p) => p.date)).toEqual(historyExpected.aggregateNetWorth.map((p) => p.date));
    for (const [i, e] of historyExpected.aggregateNetWorth.entries()) {
      expectDecimal(agg[i]!.netWorth, e.netWorth, `${e.date} netWorth`);
    }
  });

  it("a portfolio's own series is exactly its stored snapshots", async () => {
    const b = points(await get(l, `/portfolios/${l.portfolioIds.b}/history?range=all`));
    expect(b.map((p) => p.date)).toEqual(historyExpected.b.map((p) => p.date));
    for (const [i, e] of historyExpected.b.entries()) {
      expectDecimal(b[i]!.netWorth, e.netWorth, `${e.date} netWorth`);
      expectDecimal(b[i]!.marketValue, e.marketValue, `${e.date} marketValue`);
    }
  });
});

describe("loadLedger", () => {
  // Several target columns are nullable, so an unknown symbolic key must fail loudly instead of
  // inserting NULL and leaving a scenario that silently no longer tests what it claims to. One
  // case per lookup site, each with its own message.
  const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2)}`;
  const mergerCa = merger.corporateActions![0]! as Extract<
    NonNullable<typeof merger.corporateActions>[number],
    { type: "merger" }
  >;

  it.each([
    [
      "transaction instrument",
      () => ({
        ...eurBasic,
        name: unique("bad-tx-instrument"),
        transactions: [{ ...eurBasic.transactions[0]!, instrument: "nope" }],
      }),
    ],
    [
      "transaction portfolio",
      () => ({
        ...eurBasic,
        name: unique("bad-tx-portfolio"),
        transactions: [{ ...eurBasic.transactions[0]!, portfolio: "nope" }],
      }),
    ],
    [
      "corporate action instrument",
      () => ({
        ...merger,
        name: unique("bad-ca-instrument"),
        corporateActions: [{ ...mergerCa, instrument: "nope" }],
      }),
    ],
    [
      "merger portfolio",
      () => ({
        ...merger,
        name: unique("bad-ca-portfolio"),
        corporateActions: [{ ...mergerCa, portfolio: "nope" }],
      }),
    ],
    [
      "merger target instrument",
      () => ({
        ...merger,
        name: unique("bad-ca-target"),
        corporateActions: [{ ...mergerCa, target: "nope" }],
      }),
    ],
  ])("rejects an unknown %s", async (what, build) => {
    const ledger = build() as typeof merger;
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(ledger.asOf) });
    await expect(loadLedger(app, sign, ledger)).rejects.toThrow(
      new RegExp(`unknown ${what} "nope"`),
    );
  });
});

describe("aggregate boundary on single-boundary ledgers", () => {
  // Each ledger needs its own clock and user; the cash-inside one is loaded here under a
  // second user so it does not collide with the portfolio-level describe above.
  let l: LoadedLedger;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(cashInside.asOf) });
    l = await loadLedger(app, sign, cashInside, "aggregate-cash-inside");
  }, 60_000);

  it("cash-inside: /networth carries the inside boundary and the same figures", async () => {
    const nw = await get(l, "/networth");
    expect(nw.gain.boundary).toBe("inside");
    expectDecimal(nw.netWorth, cashInsideExpected.value, "netWorth", ROUNDING);
    expectGain(nw.gain, cashInsideExpected, "gain[all]");
  });
});
