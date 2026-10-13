import { describe, it, expect, vi } from "vitest";
import {
  GoldApiProvider,
  MarketDataService,
  type InstrumentRef,
  type MarketDataProvider,
} from "../src/index.js";
import { withTimeout } from "../src/http.js";

const ref = (symbol: string): InstrumentRef => ({
  symbol,
  market: "XETRA",
  assetClass: "equity",
  currency: "EUR",
});

function fake(over: Partial<MarketDataProvider> & { name: string }): MarketDataProvider {
  return { supports: () => true, getQuote: async () => null, ...over } as MarketDataProvider;
}

describe("provider fetch timeout (audit D10)", () => {
  it("adds an abort signal that rejects a hanging upstream", async () => {
    vi.useFakeTimers();
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
      })) as unknown as typeof fetch;
    const p = withTimeout(hang, 50)("http://x");
    const assertion = expect(p).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });

  it("keeps a caller-supplied signal", async () => {
    const seen: unknown[] = [];
    const f = withTimeout(((_u: unknown, init?: RequestInit) => {
      seen.push(init?.signal);
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch);
    const own = new AbortController().signal;
    await f("http://x", { signal: own });
    expect(seen[0]).toBe(own);
  });

  it("providers pass a signal to their injected fetch", async () => {
    const signals: unknown[] = [];
    const p = new GoldApiProvider("k", {
      fetch: (async (_u: unknown, init?: RequestInit) => {
        signals.push(init?.signal);
        return new Response("{}", { status: 500 });
      }) as unknown as typeof fetch,
    });
    await p
      .getQuote({ symbol: "XAU", market: "XAU", assetClass: "gold", currency: "IDR" })
      .catch(() => null);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});

describe("MarketDataService resilience (audit D10)", () => {
  it("getQuote reports a swallowed provider error via onProviderError", async () => {
    const onProviderError = vi.fn();
    const svc = new MarketDataService(
      [
        fake({
          name: "bad",
          getQuote: async () => {
            throw new Error("boom");
          },
        }),
        fake({
          name: "good",
          getQuote: async () => ({ price: "1", currency: "EUR", asOf: "2026-01-01T00:00:00Z" }),
        }),
      ],
      { onProviderError },
    );
    expect((await svc.getQuote(ref("A")))?.price).toBe("1");
    expect(onProviderError).toHaveBeenCalledWith("bad", "getQuote", expect.any(Error));
  });

  it("getDividends: a throwing provider does not abort the chain", async () => {
    const onProviderError = vi.fn();
    const svc = new MarketDataService(
      [
        fake({
          name: "bad",
          getDividends: async () => {
            throw new Error("boom");
          },
        }),
        fake({
          name: "good",
          getDividends: async () => [{ exDate: "2026-01-01", amount: "1", currency: "EUR" }],
        }),
      ],
      { onProviderError },
    );
    expect(await svc.getDividends(ref("A"))).toHaveLength(1);
    expect(onProviderError).toHaveBeenCalledWith("bad", "getDividends", expect.any(Error));
  });

  it("getDividends returns [] when every provider throws", async () => {
    const svc = new MarketDataService([
      fake({
        name: "bad",
        getDividends: async () => {
          throw new Error("boom");
        },
      }),
    ]);
    expect(await svc.getDividends(ref("A"))).toEqual([]);
  });

  it("getQuotes bounds concurrency and skips a provider past its error budget", async () => {
    let inFlight = 0;
    let peak = 0;
    let badCalls = 0;
    const svc = new MarketDataService([
      fake({
        name: "bad",
        getQuote: async () => {
          badCalls++;
          throw new Error("down");
        },
      }),
      fake({
        name: "good",
        getQuote: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return { price: "2", currency: "EUR", asOf: "2026-01-01T00:00:00Z" };
        },
      }),
    ]);
    const refs = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, ref: ref(`S${i}`) }));
    const out = await svc.getQuotes(refs);
    expect(Object.keys(out)).toHaveLength(20);
    expect(peak).toBeLessThanOrEqual(4);
    // Budget (5) stops hammering the dead provider; a little overshoot from the 4 workers.
    expect(badCalls).toBeLessThan(20);
  });
});
