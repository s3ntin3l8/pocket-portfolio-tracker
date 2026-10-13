import { describe, it, expect } from "vitest";
import {
  computeHoldings,
  createHoldingsCursor,
  type CoreTransaction,
  type CorporateAction,
} from "../src/index.js";

// Deterministic LCG so a failure reproduces.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const DAY = 86_400_000;
const T0 = Date.UTC(2024, 0, 1);
const TYPES = ["buy", "buy", "buy", "sell", "transfer_in", "transfer_out", "bonus", "dividend"];

function generate(seed: number) {
  const r = rng(seed);
  const ids = ["A", "B", "C", "D", "E"];
  const txns: CoreTransaction[] = [];
  for (let i = 0; i < 60; i++) {
    const type = TYPES[Math.floor(r() * TYPES.length)] as CoreTransaction["type"];
    // Half the rows land on whole days so same-instant tx + corporate action ties occur.
    const at = T0 + Math.floor(r() * 40) * DAY + (r() < 0.5 ? 0 : Math.floor(r() * DAY));
    txns.push({
      instrumentId: ids[Math.floor(r() * 4)]!, // "E" is only ever in a corporate action
      type,
      quantity: String(1 + Math.floor(r() * 9)),
      price: String(1 + Math.floor(r() * 50)),
      fees: r() < 0.3 ? "1" : "0",
      currency: "EUR",
      executedAt: new Date(at),
      status: r() < 0.05 ? "archived" : r() < 0.05 ? "draft" : undefined,
    });
  }
  // Deliberately NOT time-sorted: output order depends on input order.
  const cas: CorporateAction[] = [
    { instrumentId: "A", type: "split", ratio: "2", exDate: new Date(T0 + 10 * DAY) },
    { instrumentId: "B", type: "bonus", ratio: "0.1", exDate: new Date(T0 + 20 * DAY) },
    { instrumentId: "E", type: "split", ratio: "4", exDate: new Date(T0 + 5 * DAY) },
    { instrumentId: "A", type: "split", ratio: "3", exDate: new Date(T0 + 30 * DAY) },
    {
      instrumentId: "C",
      type: "merger",
      ratio: "1",
      ratioTo: "1",
      targetInstrumentId: "D",
      taxableMarketValue: "100",
      exDate: new Date(T0 + 25 * DAY),
    },
  ];
  return { txns, cas };
}

describe("createHoldingsCursor parity with computeHoldings", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`snapshot() === computeHoldings(asOf) on every day (seed ${seed})`, () => {
      const { txns, cas } = generate(seed);
      const cursor = createHoldingsCursor(txns, cas);
      for (let d = -2; d <= 45; d++) {
        const asOf = new Date(T0 + d * DAY + DAY - 1);
        cursor.advanceTo(asOf);
        expect(cursor.snapshot()).toEqual(computeHoldings(txns, cas, asOf));
      }
    });

    it(`holdingWithout(tx) matches a full replay without that row (seed ${seed})`, () => {
      const { txns, cas } = generate(seed);
      const cursor = createHoldingsCursor(txns, cas);
      const asOf = new Date(T0 + 33 * DAY);
      const candidates = txns.filter(
        (t) => (t.type === "transfer_in" || t.type === "buy") && !t.status,
      );
      for (const tx of candidates.slice(0, 24)) {
        const got = cursor.holdingWithout(tx, asOf);
        if (tx.instrumentId === "C" || tx.instrumentId === "D") {
          // Merger-linked: synthetic legs depend on held quantity → caller must replay.
          expect(got).toBeUndefined();
          continue;
        }
        const full = computeHoldings(
          txns.filter((t) => t !== tx),
          cas,
          asOf,
        ).find((h) => h.instrumentId === tx.instrumentId);
        expect(got ?? undefined).toEqual(full);
      }
    });
  }

  it("rewinds when advanceTo goes backwards", () => {
    const { txns, cas } = generate(11);
    const cursor = createHoldingsCursor(txns, cas);
    cursor.advanceTo(new Date(T0 + 40 * DAY));
    const early = new Date(T0 + 7 * DAY);
    cursor.advanceTo(early);
    expect(cursor.snapshot()).toEqual(computeHoldings(txns, cas, early));
  });

  it("keeps a transaction at the exact ex-date ahead of the action", () => {
    const at = new Date("2026-03-01T00:00:00Z");
    const txns: CoreTransaction[] = [
      {
        instrumentId: "A",
        type: "buy",
        quantity: "10",
        price: "5",
        fees: "0",
        currency: "EUR",
        executedAt: at,
      },
    ];
    const cas: CorporateAction[] = [{ instrumentId: "A", type: "split", ratio: "2", exDate: at }];
    const cursor = createHoldingsCursor(txns, cas);
    cursor.advanceTo(at);
    expect(cursor.snapshot()).toEqual(computeHoldings(txns, cas, at));
    expect(cursor.snapshot()[0]!.quantity).toBe("20");
  });

  it("holdingWithout returns undefined for a row it does not own", () => {
    const { txns, cas } = generate(1);
    const cursor = createHoldingsCursor(txns, cas);
    const stranger = { ...txns[0]! };
    expect(cursor.holdingWithout(stranger, new Date(T0 + 50 * DAY))).toBeUndefined();
  });
});
