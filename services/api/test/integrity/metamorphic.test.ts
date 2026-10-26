import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { closeDb } from "../../src/db/client.js";
import { buildIntegrityApp, loadLedger, type App, type Ledger } from "./ledger.js";
import {
  derive,
  expectSameAggregate,
  expectScaled,
  outputs,
  type Outputs,
  reverseOrder,
  roundtripCash,
  scale,
} from "./metamorphic.js";
import { eurBasic } from "./ledgers/eur-basic.js";
import { cashInside } from "./ledgers/cash-inside.js";
import { transfers } from "./ledgers/transfers.js";
import { split } from "./ledgers/split.js";
import { usdFx } from "./ledgers/usd-fx.js";
import { multiBase } from "./ledgers/multi-base.js";
import { metaBase } from "./ledgers/meta-base.js";

// Relations between a scenario and a transformed copy of it (see metamorphic.ts). Each pair is
// loaded as two separate users at the same frozen clock, base first.

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

// Every ledger is loaded once (a user and its instrument symbols are unique per ledger name);
// the clock is frozen at the ledger's own `asOf`, which derived scenarios inherit.
const loaded = new Map<string, Promise<Outputs>>();
function outputsOf(ledger: Ledger): Promise<Outputs> {
  let p = loaded.get(ledger.name);
  if (!p) {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(ledger.asOf) });
    p = loadLedger(app, sign, ledger).then((l) => outputs(app, l));
    loaded.set(ledger.name, p);
  }
  return p;
}

async function pair(base: Ledger, derived: Ledger) {
  const a = await outputsOf(base);
  const b = await outputsOf(derived);
  return { a, b };
}

const SCENARIOS = [eurBasic, cashInside, transfers, split, usdFx, multiBase, metaBase];

describe.each(SCENARIOS.map((l) => [l.name, l] as const))("%s", (_name, base) => {
  it("INSERT_ORDER: insertion order changes nothing", async () => {
    const { a, b } = await pair(base, reverseOrder(base));
    expectScaled(a, b, 1);
  }, 60_000);

  it("SCALE_QTY: ×3 quantities and amounts scale every money figure by 3, rates unchanged", async () => {
    const { a, b } = await pair(base, scale(base, 3));
    expectScaled(a, b, 3);
  }, 60_000);
});

describe("ROUNDTRIP_CASH", () => {
  it("a same-instant deposit + withdrawal changes no value, gain or return (cash inside)", async () => {
    const { a, b } = await pair(
      cashInside,
      roundtripCash(cashInside, "savings", "250", "2026-05-20T10:00:00.000Z"),
    );
    expectScaled(a, b, 1);
  }, 60_000);

  it("... and none outside the boundary either", async () => {
    const { a, b } = await pair(
      metaBase,
      roundtripCash(metaBase, "a", "250", "2026-05-20T10:00:00.000Z"),
    );
    expectScaled(a, b, 1);
  }, 60_000);
});

describe("SPLIT_PORTFOLIO", () => {
  // Move 6 of the 15 open shares to a second depot (Depotübertrag at the carried cost, avg 110).
  // Nothing was bought, sold or paid, so the aggregate is untouched.
  const moved = derive(metaBase, "moved", {
    portfolios: {
      ...metaBase.portfolios,
      b: { name: "Depot B", baseCurrency: "EUR", cashCounted: false },
    },
    transactions: [
      ...metaBase.transactions,
      {
        portfolio: "a",
        type: "transfer_out",
        instrument: "abc",
        quantity: "6",
        price: "0",
        currency: "EUR",
        at: "2026-05-01T10:00:00.000Z",
      },
      {
        portfolio: "b",
        type: "transfer_in",
        instrument: "abc",
        quantity: "6",
        price: "110",
        currency: "EUR",
        at: "2026-05-01T10:00:00.000Z",
      },
    ],
  });

  it("moving shares between depots leaves the aggregate value, gains and contribution unchanged", async () => {
    const { a, b } = await pair(metaBase, moved);
    expectSameAggregate(a, b, { skipXirr: true });
  }, 60_000);

  it("... and the all-time XIRR", async () => {
    const { a, b } = await pair(metaBase, moved);
    expectSameAggregate(a, b);
  }, 60_000);
});

describe("SPLIT_EQUIVALENCE", () => {
  // A 2:1 split of 10 shares bought at 200 must look exactly like having bought 20 at 100.
  const mk = (name: string): Ledger => ({
    ...metaBase,
    name,
    instruments: {
      abc: { ...metaBase.instruments.abc!, price: "70" },
    },
  });
  const viaSplit: Ledger = {
    ...mk("eq-split"),
    corporateActions: [{ instrument: "abc", type: "split", ratio: "2", exDate: "2026-03-01" }],
    transactions: [
      {
        portfolio: "a",
        type: "buy",
        instrument: "abc",
        quantity: "10",
        price: "200",
        currency: "EUR",
        at: "2026-01-10T10:00:00.000Z",
      },
      {
        portfolio: "a",
        type: "sell",
        instrument: "abc",
        quantity: "5",
        price: "65",
        currency: "EUR",
        at: "2026-04-01T10:00:00.000Z",
      },
    ],
  };
  const viaBuy: Ledger = {
    ...mk("eq-buy"),
    transactions: [
      {
        portfolio: "a",
        type: "buy",
        instrument: "abc",
        quantity: "20",
        price: "100",
        currency: "EUR",
        at: "2026-01-10T10:00:00.000Z",
      },
      {
        portfolio: "a",
        type: "sell",
        instrument: "abc",
        quantity: "5",
        price: "65",
        currency: "EUR",
        at: "2026-04-01T10:00:00.000Z",
      },
    ],
  };

  it("a split is equivalent to buying more shares at a proportionally lower price", async () => {
    const { a, b } = await pair(viaSplit, viaBuy);
    expectScaled(a, b, 1);
    expect(a.networth.gain).toBeTruthy();
  }, 60_000);
});
