/**
 * A provider that reports its quota exhausted (HTTP 402 daily limit, 429 rate limit, or a
 * `getUsage()` that says used >= limit) must stop being called — every further call burns
 * budget it no longer has — until its window resets; the fallback chain keeps answering.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  EodhdProvider,
  MarketDataError,
  MarketDataService,
  type InstrumentRef,
  type MarketDataProvider,
  type ProviderUsage,
  type Quote,
} from "../src/index.js";

const ref: InstrumentRef = { symbol: "AAPL", market: "US", assetClass: "equity", currency: "USD" };
const quote = (price: string): Quote => ({
  price,
  currency: "USD",
  asOf: new Date().toISOString(),
});

function provider(
  name: string,
  getQuote: () => Promise<Quote | null>,
  extra: Partial<MarketDataProvider> = {},
): MarketDataProvider & { calls: number } {
  const p = {
    name,
    calls: 0,
    supports: () => true,
    getQuote: async () => {
      p.calls++;
      return getQuote();
    },
    ...extra,
  } as MarketDataProvider & { calls: number };
  return p;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("quota circuit breaker", () => {
  it("stops calling a provider after a 402 and keeps answering from the fallback", async () => {
    const quota = provider("quota", async () => {
      throw new MarketDataError("limit", "quota", 402);
    });
    const yahoo = provider("yahoo", async () => quote("10"));
    const errors: string[] = [];
    const svc = new MarketDataService([quota, yahoo], { onProviderError: (p) => errors.push(p) });

    expect((await svc.getQuote(ref))?.price).toBe("10");
    expect((await svc.getQuote(ref))?.price).toBe("10");
    await svc.getQuotes([
      { id: "a", ref },
      { id: "b", ref },
    ]);

    expect(quota.calls).toBe(1); // only the call that learned about the quota
    expect(errors).toEqual(["quota"]);
    expect(svc.getBlockedProviders().map((b) => b.provider)).toEqual(["quota"]);
  });

  it("resumes at the next UTC midnight after a 402", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T22:00:00Z"));
    let exhausted = true;
    const quota = provider("quota", async () => {
      if (exhausted) throw new MarketDataError("limit", "quota", 402);
      return quote("7");
    });
    const yahoo = provider("yahoo", async () => quote("10"));
    const svc = new MarketDataService([quota, yahoo]);

    await svc.getQuote(ref);
    expect(svc.getBlockedProviders()[0]!.until.toISOString()).toBe("2026-10-28T00:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-27T23:59:00Z"));
    await svc.getQuote(ref);
    expect(quota.calls).toBe(1);

    exhausted = false;
    vi.setSystemTime(new Date("2026-10-28T00:00:01Z"));
    expect((await svc.getQuote(ref))?.price).toBe("7");
    expect(svc.getBlockedProviders()).toEqual([]);
  });

  it("pauses a 429 only briefly, and ignores errors that are not quota signals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    let status = 429;
    const flaky = provider("flaky", async () => {
      throw new MarketDataError("nope", "flaky", status);
    });
    const yahoo = provider("yahoo", async () => quote("10"));
    const svc = new MarketDataService([flaky, yahoo]);

    await svc.getQuote(ref);
    await svc.getQuote(ref);
    expect(flaky.calls).toBe(1);
    vi.setSystemTime(new Date("2026-10-27T10:11:00Z")); // past the 10 min cooldown
    status = 503; // a plain outage must not trip the breaker
    await svc.getQuote(ref);
    await svc.getQuote(ref);
    expect(flaky.calls).toBe(3);
    expect(svc.getBlockedProviders()).toEqual([]);
  });

  it("covers history, dividends, profile and search, not just quotes", async () => {
    const calls = { history: 0, search: 0 };
    const quota: MarketDataProvider = {
      name: "quota",
      supports: () => true,
      getQuote: async () => {
        throw new MarketDataError("limit", "quota", 402);
      },
      getHistoryFrom: async () => {
        calls.history++;
        return [];
      },
      resolveName: async () => {
        calls.search++;
        return null;
      },
    };
    const svc = new MarketDataService([quota]);
    await svc.getQuote(ref); // trips it
    await svc.getHistoryFrom(ref, "2026-01-01", { allowMaxFallback: false });
    await svc.resolveName("Apple");
    expect(calls).toEqual({ history: 0, search: 0 });
  });

  describe("usage probe", () => {
    const usage = (used: number | null, limit: number | null, window: "day" | "month" = "day") =>
      ({ window, used, limit }) as ProviderUsage;

    function probed(getUsage: () => Promise<ProviderUsage | null>) {
      return provider("eod", async () => quote("7"), { quotaProbe: true, getUsage });
    }

    it("skips a provider whose daily usage has reached its limit, before any call", async () => {
      const eod = probed(async () => usage(20, 20));
      const yahoo = provider("yahoo", async () => quote("10"));
      const errors: [string, string][] = [];
      const svc = new MarketDataService([eod, yahoo], {
        onProviderError: (p, m) => errors.push([p, m]),
      });
      expect((await svc.getQuote(ref))?.price).toBe("10");
      expect(eod.calls).toBe(0);
      expect(errors).toEqual([["eod", "quota"]]);
    });

    it("uses the provider while it has headroom, and probes at most once a minute", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
      const getUsage = vi.fn(async () => usage(5, 20));
      const eod = probed(getUsage);
      const svc = new MarketDataService([eod, provider("yahoo", async () => quote("10"))]);
      await svc.getQuote(ref);
      await svc.getQuote(ref);
      expect(getUsage).toHaveBeenCalledTimes(1);
      expect(eod.calls).toBe(2);
      vi.setSystemTime(new Date("2026-10-27T10:01:01Z"));
      await svc.getQuote(ref);
      expect(getUsage).toHaveBeenCalledTimes(2);
    });

    it("fails open when the probe errors, has no daily window, or reports no limit", async () => {
      for (const getUsage of [
        async () => {
          throw new Error("boom");
        },
        async () => null,
        async () => usage(100, 100, "month"),
        async () => usage(20, null),
      ]) {
        const eod = probed(getUsage as () => Promise<ProviderUsage | null>);
        const svc = new MarketDataService([eod]);
        expect((await svc.getQuote(ref))?.price).toBe("7");
      }
    });

    it("resumes when the probe reports headroom again (extra calls bought)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
      let limit = 20;
      const eod = probed(async () => usage(20, limit));
      const svc = new MarketDataService([eod, provider("yahoo", async () => quote("10"))]);
      await svc.getQuote(ref);
      expect(eod.calls).toBe(0);
      limit = 100;
      vi.setSystemTime(new Date("2026-10-27T10:02:00Z"));
      expect((await svc.getQuote(ref))?.price).toBe("7");
    });
  });
});

describe("EodhdProvider quota responses", () => {
  const eodhd = (status: number) =>
    new EodhdProvider({
      apiKey: "k",
      fetch: (async () => new Response("{}", { status })) as typeof fetch,
    });
  const xetra: InstrumentRef = {
    symbol: "VWCE",
    market: "XETRA",
    assetClass: "etf",
    currency: "EUR",
  };

  it("throws a MarketDataError on 402 and 429 instead of returning an empty result", async () => {
    for (const status of [402, 429]) {
      await expect(eodhd(status).getQuote(xetra)).rejects.toMatchObject({
        name: "MarketDataError",
        status,
        provider: "eodhd",
      });
      await expect(eodhd(status).getDividends(xetra)).rejects.toBeInstanceOf(MarketDataError);
    }
  });

  it("still treats other non-OK statuses as 'no data'", async () => {
    expect(await eodhd(404).getQuote(xetra)).toBeNull();
    expect(await eodhd(404).getDividends(xetra)).toEqual([]);
  });

  it("declares itself a quota-probed provider", () => {
    expect(eodhd(200).quotaProbe).toBe(true);
  });
});
