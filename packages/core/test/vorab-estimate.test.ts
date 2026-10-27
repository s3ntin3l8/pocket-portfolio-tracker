import { describe, it, expect, vi } from "vitest";
import {
  estimateVorabRows,
  computeTrades,
  allowanceUsageYTD,
  type CoreTransaction,
  type CorporateAction,
} from "../src/index.js";

const ID = "fund-1";
const NOW = new Date("2026-03-01T00:00:00Z");

function tx(p: Partial<CoreTransaction>): CoreTransaction {
  return {
    instrumentId: ID,
    type: "buy",
    quantity: "0",
    price: "0",
    fees: "0",
    currency: "EUR",
    executedAt: new Date("2023-01-01T00:00:00Z"),
    ...p,
  };
}

/** Price table as `priceOn`: latest entry on or before the date. */
function prices(table: Record<string, string>, currency = "EUR") {
  return (_id: string, date: string) => {
    const keys = Object.keys(table)
      .filter((k) => k <= date)
      .sort();
    const k = keys[keys.length - 1];
    return k ? { close: table[k]!, currency } : null;
  };
}

const flat2025 = { "2025-01-01": "100", "2025-12-31": "110" };

function run(
  txns: CoreTransaction[],
  priceOn = prices(flat2025),
  extra: { cas?: CorporateAction[]; warn?: (m: string) => void; now?: Date } = {},
) {
  return estimateVorabRows({
    transactions: txns,
    corporateActions: extra.cas ?? [],
    isFund: () => true,
    priceOn,
    now: extra.now ?? NOW,
    warn: extra.warn,
  });
}

describe("estimateVorabRows", () => {
  it("full year: units held all of 2025 get units x per-unit Vorabpauschale", () => {
    const rows = run(
      [tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") })],
      prices({ ...flat2025, "2024-12-31": "95" }),
    );
    // 2025 only (2024 needs 2024 prices): per unit = min(100 x 2.53% x 70%, 10) = 1.771
    const r = rows.find((x) => x.executedAt.getUTCFullYear() === 2026)!;
    expect(r).toMatchObject({
      instrumentId: ID,
      type: "tax",
      kind: "vorabpauschale",
      estimated: true,
      vorabBase: "17.71",
      currency: "EUR",
    });
    expect(r.executedAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("in-year purchase: reduced 1/12 per full month before the purchase month (after the cap)", () => {
    // Bought in July 2025 -> months July..Dec = 6; cap not binding.
    const rows = run([tx({ quantity: "10", price: "100", executedAt: new Date("2025-07-15") })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.vorabBase).toBe("8.86"); // 10 x 1.771 x 6/12 = 8.855
  });

  it("applies the cap per unit before the monthly reduction", () => {
    const rows = run(
      [tx({ quantity: "10", price: "100", executedAt: new Date("2025-07-15") })],
      prices({ "2025-01-01": "100", "2025-12-31": "100.5" }),
    );
    expect(rows[0]!.vorabBase).toBe("2.50"); // min(1.771, 0.5) x 10 x 6/12
  });

  it("partial sale consumes the oldest units first (FIFO); sold units get none", () => {
    const rows = run([
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }), // 12 months
      tx({ quantity: "10", price: "100", executedAt: new Date("2025-07-15") }), // 6 months
      tx({ type: "sell", quantity: "10", price: "105", executedAt: new Date("2025-09-01") }),
    ]);
    // The sale removes the 10 pre-year units; only the July units remain.
    expect(rows[0]!.vorabBase).toBe("8.86");
  });

  it("units fully sold before year end produce no row", () => {
    const rows = run([
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }),
      tx({ type: "sell", quantity: "10", price: "105", executedAt: new Date("2025-12-30") }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("split-adjusts raw prices so quantities and prices share a basis", () => {
    // 2:1 split in 2025-06; raw prices before the split are double the adjusted ones.
    const cas: CorporateAction[] = [
      { instrumentId: ID, type: "split", ratio: "2", exDate: new Date("2025-06-01") },
    ];
    const rows = run(
      [tx({ quantity: "10", price: "180", executedAt: new Date("2024-06-03") })],
      prices({ "2025-01-01": "200", "2025-12-31": "110" }),
      { cas },
    );
    // 20 current-terms units, adjusted start price 100 -> 20 x 1.771
    expect(rows[0]!.vorabBase).toBe("35.42");
  });

  it("distributions reduce the Vorabpauschale per unit", () => {
    const rows = run([
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }),
      tx({ type: "dividend", quantity: "0", price: "5", executedAt: new Date("2025-06-01") }),
    ]);
    // per unit: distribution 0.5; min(1.771, 10 + 0.5) - 0.5 = 1.271 -> 12.71
    expect(rows[0]!.vorabBase).toBe("12.71");
  });

  it("a broker-booked Vorabpauschale for that year suppresses the estimate", () => {
    const rows = run([
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }),
      tx({
        type: "tax",
        kind: "vorabpauschale",
        vorabBase: "9.99",
        executedAt: new Date("2026-01-27"),
      }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("a booked row without a base does not suppress the estimate", () => {
    const rows = run([
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }),
      tx({ type: "tax", kind: "vorabpauschale", executedAt: new Date("2026-01-27") }),
      tx({
        type: "tax",
        kind: "vorabpauschale",
        vorabBase: "0",
        executedAt: new Date("2026-01-28"),
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estimated).toBe(true);
  });

  it("a broker row dated late in the next year (not just January) still suppresses the estimate", () => {
    const rows = run([
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }),
      tx({
        type: "tax",
        kind: "vorabpauschale",
        vorabBase: "9.99",
        executedAt: new Date("2026-03-15"),
      }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("missing price: no row, never zero, and warns", () => {
    const warn = vi.fn();
    const rows = run(
      [tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") })],
      prices({ "2025-12-31": "110" }),
      { warn },
    );
    expect(rows).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("unknown Basiszins year: no row and warns", () => {
    const warn = vi.fn();
    const rows = run(
      [tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") })],
      prices({ "2030-01-01": "100", "2030-12-31": "110" }),
      { warn, now: new Date("2031-03-01") },
    );
    expect(rows.filter((r) => r.executedAt.getUTCFullYear() === 2031)).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("price in another currency than the transactions: no row", () => {
    const rows = run(
      [tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") })],
      prices(flat2025, "USD"),
    );
    expect(rows).toHaveLength(0);
  });

  it("non-funds and the current (unfinished) year are never estimated", () => {
    const base = [tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") })];
    expect(
      estimateVorabRows({
        transactions: base,
        corporateActions: [],
        isFund: () => false,
        priceOn: prices(flat2025),
        now: NOW,
      }),
    ).toHaveLength(0);
    // Deemed receipt not reached yet (now = 1 Jan 2026 < 2 Jan 2026): no row for 2025.
    expect(run(base, prices(flat2025), { now: new Date("2026-01-01T12:00:00Z") })).toHaveLength(0);
  });

  it("a later sell is credited with the estimated accrual regardless of input order", () => {
    const txns = [
      tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") }),
      tx({ type: "sell", quantity: "10", price: "120", executedAt: new Date("2026-06-01") }),
    ];
    // Estimated rows are appended AFTER the later sell, as the API wiring does.
    const log = computeTrades({
      transactions: [...txns, ...run(txns)],
      corporateActions: [],
      prices: { [ID]: { price: "120", currency: "EUR" } },
      displayCurrency: "EUR",
      fx: () => ({ rate: "1" }) as never,
      method: "fifo",
    } as never);
    expect(log.trades[0]!.legs[0]!.vorabCredit).toBe("17.71");
  });

  it("feeds the trade log as an estimated accrual that allowance usage flags", () => {
    const txns = [tx({ quantity: "10", price: "90", executedAt: new Date("2024-06-03") })];
    const rows = run(txns);
    const log = computeTrades({
      transactions: [...txns, ...rows],
      corporateActions: [],
      prices: { [ID]: { price: "110", currency: "EUR" } },
      displayCurrency: "EUR",
      fx: () => ({ rate: "1" }) as never,
      method: "fifo",
    } as never);
    expect(log.trades[0]!.vorabByYear).toEqual([{ year: 2026, amount: "17.71", estimated: true }]);
    const usage = allowanceUsageYTD({
      tradeLog: log,
      tfRates: {},
      allowanceAnnual: "1000",
      year: 2026,
    } as never);
    expect(usage.vorabpauschaleEstimated).toBe(true);
    expect(usage.vorabpauschaleAccrued).toBe("17.71");
  });
});
