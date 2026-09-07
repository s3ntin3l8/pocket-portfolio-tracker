/**
 * B3 — Engine consumes `taxableMarketValue` directly (PR-Batch 2, audit v0.2.0).
 *
 * Today the engine trusts the merger importer (services/api/src/routes/mergers.ts) to
 * pre-price both legs of a fund merger as a sell+buy pair (kind:"merger"). If a future
 * importer forgets to write that pair — or any external source emits only the
 * `corporateActions` row — the tax event silently disappears (no realized gain on the
 * sell, no stepped-up basis on the buy). The fix lets the engine derive the pair from
 * the CA's `taxableMarketValue` alone:
 *
 *   sell leg:  qty = held qty at exDate, price = taxableMarketValue / qty
 *   buy  leg:  qty = held qty * ratioTo,   price = taxableMarketValue / inQty
 *
 * If the pair IS already present (current importer writes it), validate it against
 * `taxableMarketValue` (defense in depth) and process the existing legs unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import {
  computeTrades,
  computeHoldings,
  openLots,
  type CoreTransaction,
  type CorporateAction,
} from "../../src/index.js";

const OLD = "inst-old";
const NEW = "inst-new";

function buyTx(p: Partial<CoreTransaction>): CoreTransaction {
  return {
    instrumentId: OLD,
    type: "buy",
    quantity: "0",
    price: "0",
    fees: "0",
    currency: "EUR",
    executedAt: new Date("2024-01-01"),
    ...p,
  };
}

function mergerCa(p: Partial<CorporateAction>): CorporateAction {
  return {
    instrumentId: OLD,
    type: "merger",
    ratio: "2", // outQty / inQty = 10 / 5
    exDate: new Date("2024-02-01"),
    targetInstrumentId: NEW,
    ratioTo: "0.5", // inQty / outQty = 5 / 10
    ...p,
  };
}

describe("computeTrades — merger CA consumes taxableMarketValue (B3)", () => {
  it("round-trip: pre-priced pair from importer → engine produces same result (no behavior change)", () => {
    // Mirrors what services/api/src/routes/mergers.ts writes today: a sell leg at
    // MV/outQty and a buy leg at MV/inQty, both kind:"merger". This MUST remain the
    // happy path so the existing /portfolios/:id/mergers endpoint keeps working.
    const txns: CoreTransaction[] = [
      buyTx({ quantity: "10", price: "100" }), // basis 1000
      // Taxable merger: sell @ MV/10 = 120, buy @ MV/5 = 240. Realized gain = 200.
      {
        instrumentId: OLD,
        type: "sell",
        quantity: "10",
        price: "120",
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
      {
        instrumentId: NEW,
        type: "buy",
        quantity: "5",
        price: "240",
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
    ];
    const cas: CorporateAction[] = [mergerCa({ taxableMarketValue: "1200" })];
    const { trades } = computeTrades({
      transactions: txns,
      prices: {
        [OLD]: { price: "120", currency: "EUR" },
        [NEW]: { price: "240", currency: "EUR" },
      },
      displayCurrency: "EUR",
      now: new Date("2024-06-01"),
      corporateActions: cas,
    });
    const oldTrade = trades.find((t) => t.instrumentId === OLD)!;
    const newTrade = trades.find((t) => t.instrumentId === NEW)!;
    // The pre-priced pair already exists — round-trip preserved.
    expect(oldTrade.realizedPnL).toBe("200"); // 1200 − 1000
    expect(newTrade.invested).toBe("1200"); // stepped up to MV
  });

  it("fallback: CA with taxableMarketValue but NO transaction pair → engine synthesizes both legs", () => {
    // A future importer that emits ONLY the corporate_actions row (no sell/buy legs)
    // must NOT silently drop the tax event. The engine derives the pair from the CA.
    const txns: CoreTransaction[] = [
      buyTx({ quantity: "10", price: "100" }), // basis 1000, held qty = 10
    ];
    const cas: CorporateAction[] = [
      mergerCa({ taxableMarketValue: "1200" }), // ratio=2, ratioTo=0.5 → 10 out, 5 in
    ];
    const { trades } = computeTrades({
      transactions: txns,
      prices: {
        [OLD]: { price: "120", currency: "EUR" },
        [NEW]: { price: "240", currency: "EUR" },
      },
      displayCurrency: "EUR",
      now: new Date("2024-06-01"),
      corporateActions: cas,
    });
    const oldTrade = trades.find((t) => t.instrumentId === OLD)!;
    const newTrade = trades.find((t) => t.instrumentId === NEW)!;
    // Synthesized sell leg: realized gain = MV − basis = 1200 − 1000 = 200.
    expect(oldTrade.realizedPnL).toBe("200");
    // Synthesized buy leg: stepped-up basis = MV = 1200.
    expect(newTrade.invested).toBe("1200");
  });

  it("fallback: tax-neutral merger (no taxableMarketValue) is unchanged — pair missing is a no-op", () => {
    // For a tax-neutral merger, the importer prices the legs at carried basis (no
    // MV), and the CA's taxableMarketValue is null. If the pair is missing here, we
    // CAN'T synthesize without an MV — bail silently rather than guess.
    const txns: CoreTransaction[] = [buyTx({ quantity: "10", price: "100" })];
    const cas: CorporateAction[] = [
      mergerCa({ taxableMarketValue: undefined }), // no market value → no fallback
    ];
    const { trades } = computeTrades({
      transactions: txns,
      prices: { [OLD]: { price: "120", currency: "EUR" } },
      displayCurrency: "EUR",
      now: new Date("2024-06-01"),
      corporateActions: cas,
    });
    // The old position stays open (no sell leg → no disposal); new instrument unseen.
    expect(trades.find((t) => t.instrumentId === OLD)?.realizedPnL ?? "0").toBe("0");
    expect(trades.find((t) => t.instrumentId === NEW)).toBeUndefined();
  });

  it("defense-in-depth: existing pair with mismatched proceeds still flows through (validation logs but doesn't fail)", () => {
    // If a malformed pair's proceeds don't equal taxableMarketValue, the engine keeps
    // the pair (it's the importer's data; user sees the value) but doesn't break.
    // The test asserts the pair is still processed — no throw.
    const txns: CoreTransaction[] = [
      buyTx({ quantity: "10", price: "100" }),
      {
        instrumentId: OLD,
        type: "sell",
        quantity: "10",
        price: "110", // proceeds = 1100 ≠ MV 1200 (mismatch)
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
      {
        instrumentId: NEW,
        type: "buy",
        quantity: "5",
        price: "220", // basis = 1100 ≠ MV 1200
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
    ];
    const cas: CorporateAction[] = [mergerCa({ taxableMarketValue: "1200" })];
    expect(() =>
      computeTrades({
        transactions: txns,
        prices: {},
        displayCurrency: "EUR",
        now: new Date("2024-06-01"),
        corporateActions: cas,
      }),
    ).not.toThrow();
  });

  it("defense-in-depth: mismatched proceeds emit a structured stderr warning (defense-in-depth validation)", () => {
    // Spec: the engine must validate pre-priced pairs against taxableMarketValue
    // (defense in depth). When proceeds ≠ MV, emit a structured warning so
    // downstream log shippers can flag the mismatch — without failing the run.
    // Today (pre-fix) the engine discards `sellPair` and emits nothing; this test
    // asserts that the warning is actually emitted post-fix.
    const txns: CoreTransaction[] = [
      buyTx({ quantity: "10", price: "100" }),
      {
        instrumentId: OLD,
        type: "sell",
        quantity: "10",
        price: "110", // proceeds = 1100 ≠ MV 1200
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
      {
        instrumentId: NEW,
        type: "buy",
        quantity: "5",
        price: "240", // matches MV at 1200/5, but sell leg mismatches
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
    ];
    const cas: CorporateAction[] = [mergerCa({ taxableMarketValue: "1200" })];

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      computeTrades({
        transactions: txns,
        prices: {},
        displayCurrency: "EUR",
        now: new Date("2024-06-01"),
        corporateActions: cas,
      });

      const warnings = stderrSpy.mock.calls
        .map((call) => String(call[0] ?? ""))
        .filter((line) => line.includes("merger_importer_proceeds_mismatch"));
      expect(warnings).toHaveLength(1);
      const payload = JSON.parse(warnings[0]!.trim());
      expect(payload.level).toBe("warn");
      expect(payload.event).toBe("merger_importer_proceeds_mismatch");
      expect(payload.expected).toBe("1200");
      expect(payload.got).toBe("1100");
      expect(typeof payload.caId).toBe("string");
      expect(payload.caId.length).toBeGreaterThan(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("defense-in-depth: matching pair does NOT emit a warning", () => {
    // Sanity check: when the pre-priced pair already equals MV, no warning is
    // emitted (avoid log spam on the happy path the importer is supposed to write).
    const txns: CoreTransaction[] = [
      buyTx({ quantity: "10", price: "100" }),
      {
        instrumentId: OLD,
        type: "sell",
        quantity: "10",
        price: "120", // proceeds = 1200 = MV
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
      {
        instrumentId: NEW,
        type: "buy",
        quantity: "5",
        price: "240",
        fees: "0",
        currency: "EUR",
        executedAt: new Date("2024-02-01"),
        kind: "merger",
      },
    ];
    const cas: CorporateAction[] = [mergerCa({ taxableMarketValue: "1200" })];

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      computeTrades({
        transactions: txns,
        prices: {},
        displayCurrency: "EUR",
        now: new Date("2024-06-01"),
        corporateActions: cas,
      });

      const warnings = stderrSpy.mock.calls
        .map((call) => String(call[0] ?? ""))
        .filter((line) => line.includes("merger_importer_proceeds_mismatch"));
      expect(warnings).toHaveLength(0);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe("computeHoldings — merger CA synthesizes the pair (B3 mirror)", () => {
  it("synthesizes the pair so the new instrument appears with stepped-up basis", () => {
    const txns: CoreTransaction[] = [
      buyTx({ quantity: "10", price: "100" }), // 1000 EUR basis
    ];
    const cas: CorporateAction[] = [mergerCa({ taxableMarketValue: "1200" })];
    const holdings = computeHoldings(txns, cas);
    const oldH = holdings.find((h) => h.instrumentId === OLD)!;
    const newH = holdings.find((h) => h.instrumentId === NEW)!;
    expect(oldH.quantity).toBe("0");
    expect(Number(oldH.realizedPnL)).toBe(200); // 1200 − 1000
    expect(newH.quantity).toBe("5");
    expect(newH.costBasis).toBe("1200"); // stepped up to MV
    expect(newH.avgCost).toBe("240");
  });
});

describe("openLots — merger CA synthesizes the pair (B3 mirror)", () => {
  it("synthesizes the buy leg as a fresh lot on the new instrument", () => {
    const txns: CoreTransaction[] = [buyTx({ quantity: "10", price: "100" })];
    const cas: CorporateAction[] = [mergerCa({ taxableMarketValue: "1200" })];
    const lots = openLots(txns, cas);
    // Old instrument fully closed by the synthesized sell → no lots.
    expect(lots.get(OLD) ?? []).toHaveLength(0);
    // New instrument has one lot at the stepped-up per-share basis.
    expect(lots.get(NEW)).toEqual([
      { acqDate: "2024-02-01", qty: "5", unitCost: "240", cost: "1200" },
    ]);
  });
});
