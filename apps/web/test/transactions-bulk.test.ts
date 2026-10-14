import { describe, it, expect, vi } from "vitest";
import {
  BULK_CHUNK,
  groupIdsByPortfolio,
  runBulkByPortfolio,
} from "../src/components/transactions-table/bulk";

describe("groupIdsByPortfolio", () => {
  it("groups ids per portfolio, preserving order", () => {
    const g = groupIdsByPortfolio([
      { id: "a", portfolioId: "p1" },
      { id: "b", portfolioId: "p2" },
      { id: "c", portfolioId: "p1" },
    ]);
    expect(g.get("p1")).toEqual(["a", "c"]);
    expect(g.get("p2")).toEqual(["b"]);
  });
});

describe("runBulkByPortfolio", () => {
  it("splits a large selection into BULK_CHUNK-sized requests per portfolio", async () => {
    const ids = Array.from({ length: BULK_CHUNK * 2 + 7 }, (_, i) => `id${i}`);
    const fn = vi.fn(async (_p: string, chunk: string[]) => chunk.length);
    const results = await runBulkByPortfolio(
      new Map([
        ["p1", ids],
        ["p2", ["x"]],
      ]),
      fn,
    );
    expect(fn).toHaveBeenCalledTimes(4);
    expect(results.reduce((a, b) => a + b, 0)).toBe(ids.length + 1);
    expect(Math.max(...results)).toBe(BULK_CHUNK);
  });

  it("does nothing for an empty selection", async () => {
    const fn = vi.fn();
    expect(await runBulkByPortfolio(new Map(), fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
