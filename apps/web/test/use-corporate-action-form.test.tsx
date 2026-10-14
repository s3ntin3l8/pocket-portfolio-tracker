import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode, FormEvent } from "react";
import type { Instrument, InstrumentSearchResult } from "@portfolio/api-client";
import {
  useCorporateActionForm,
  type RecordCorpActionClient,
  type UseCorporateActionFormOptions,
} from "../src/components/record-corporate-action/use-corporate-action-form";
import messages from "../messages/en.json";

const m = messages.CorpAction;

function inst(id: string, symbol: string): Instrument {
  return {
    id,
    isin: null,
    wkn: null,
    symbol,
    market: "XETRA",
    assetClass: "etf",
    unit: "shares",
    currency: "EUR",
    name: symbol,
  };
}
const A = inst("i-a", "AAA");
const B = inst("i-b", "BBB");

function makeClient(over: Partial<RecordCorpActionClient> = {}): RecordCorpActionClient {
  return {
    searchInstruments: vi.fn(async () => [A]),
    lookupInstruments: vi.fn(async () => []),
    createCorporateAction: vi.fn(async () => ({})),
    createMerger: vi.fn(async () => ({})),
    ...over,
  } as unknown as RecordCorpActionClient;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

function setup(opts: Partial<UseCorporateActionFormOptions> = {}) {
  const client = opts.client ?? makeClient();
  const hook = renderHook(() => useCorporateActionForm({ ...opts, client }), { wrapper });
  return { client, ...hook };
}

const evt = { preventDefault: vi.fn() } as unknown as FormEvent;

afterEach(() => vi.useRealTimers());

describe("useCorporateActionForm", () => {
  it("defaults to split for admins and merger otherwise", () => {
    expect(setup({ isAdmin: true }).result.current.type).toBe("split");
    const r = setup().result.current;
    expect(r.type).toBe("merger");
    expect(r.isMerger).toBe(true);
  });

  it("switches type and updates field state", () => {
    const { result } = setup({ isAdmin: true });
    act(() => result.current.setType("bonus"));
    expect(result.current.isMerger).toBe(false);
    act(() => {
      result.current.setRatio("2");
      result.current.setExDate("2026-01-02");
      result.current.setTaxable(true);
      result.current.setOutQty("1");
    });
    expect(result.current.ratio).toBe("2");
    expect(result.current.exDate).toBe("2026-01-02");
    expect(result.current.taxable).toBe(true);
    expect(result.current.outQty).toBe("1");
  });

  describe("lookup", () => {
    it("searches locally at once, debounces market-data discovery", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const found = [{ symbol: "ZZZ", market: "X", source: "s", name: "Z", currency: "EUR" }];
      const client = makeClient({
        lookupInstruments: vi.fn(async () => found as unknown as InstrumentSearchResult[]),
      });
      const { result } = setup({ client, isAdmin: true });
      act(() => result.current.runSearch(" aa "));
      expect(result.current.query).toBe(" aa ");
      expect(client.searchInstruments).toHaveBeenCalledWith("aa");
      expect(client.lookupInstruments).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.results).toEqual([A]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(client.lookupInstruments).toHaveBeenCalledWith("aa");
      expect(result.current.discovered).toEqual(found);
    });

    it("clears results on empty query and swallows search errors", async () => {
      const client = makeClient({
        searchInstruments: vi.fn(async () => {
          throw new Error("x");
        }),
      });
      const { result } = setup({ client, isAdmin: true });
      act(() => result.current.runSearch("a"));
      await waitFor(() => expect(client.searchInstruments).toHaveBeenCalled());
      expect(result.current.results).toEqual([]);
      act(() => result.current.runSearch("  "));
      expect(result.current.results).toEqual([]);
      expect(result.current.discovered).toEqual([]);
    });

    it("selectResult picks the instrument and clears lists", async () => {
      const { result } = setup({ isAdmin: true });
      act(() => result.current.runSearch("a"));
      await waitFor(() => expect(result.current.results).toEqual([A]));
      act(() => result.current.selectResult(A));
      expect(result.current.selected).toBe(A);
      expect(result.current.results).toEqual([]);
    });

    it("selectDiscovered auto-selects a local match by ISIN, else shows an info notice", async () => {
      const found = { symbol: "ZZZ", isin: "DE000", name: "Z" } as InstrumentSearchResult;
      const search = vi.fn(async () => [A]);
      const { result } = setup({
        client: makeClient({ searchInstruments: search }),
        isAdmin: true,
      });
      await act(() => result.current.selectDiscovered(found));
      expect(search).toHaveBeenCalledWith("DE000");
      expect(result.current.selected).toBe(A);
      expect(result.current.query).toBe("");

      search.mockResolvedValueOnce([]);
      act(() => result.current.setSelected(null));
      await act(() => result.current.selectDiscovered(found));
      expect(result.current.selected).toBeNull();
      expect(result.current.query).toBe("ZZZ");
      expect(result.current.info).toContain("ZZZ");
    });

    it("selectDiscovered swallows lookup errors", async () => {
      const { result } = setup({
        client: makeClient({
          searchInstruments: vi.fn(async () => {
            throw new Error("x");
          }),
        }),
        isAdmin: true,
      });
      await act(() =>
        result.current.selectDiscovered({ symbol: "Q" } as unknown as InstrumentSearchResult),
      );
      expect(result.current.selected).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe("submit (split)", () => {
    it("requires an instrument", async () => {
      const { result, client } = setup({ isAdmin: true });
      await act(() => result.current.submit(evt));
      expect(result.current.error).toBe(m.needInstrument);
      expect(client.createCorporateAction).not.toHaveBeenCalled();
    });

    it("creates the action, defaulting the ratio to 1, and calls onSuccess", async () => {
      const onSuccess = vi.fn();
      const { result, client } = setup({ isAdmin: true, onSuccess });
      act(() => {
        result.current.selectResult(A);
        result.current.setExDate("2026-03-04");
      });
      await act(() => result.current.submit(evt));
      expect(client.createCorporateAction).toHaveBeenCalledWith({
        instrumentId: "i-a",
        type: "split",
        ratio: "1",
        exDate: new Date("2026-03-04"),
      });
      expect(onSuccess).toHaveBeenCalled();
      expect(result.current.busy).toBe(false);
    });

    it("surfaces a generic error when the call fails", async () => {
      const { result } = setup({
        isAdmin: true,
        client: makeClient({
          createCorporateAction: vi.fn(async () => {
            throw new Error("x");
          }),
        }),
      });
      act(() => result.current.selectResult(A));
      await act(() => result.current.submit(evt));
      expect(result.current.error).toBe(m.error);
    });
  });

  describe("submit (merger)", () => {
    it("requires both instruments, then a portfolio", async () => {
      const { result, client } = setup({ portfolioId: undefined });
      await act(() => result.current.submit(evt));
      expect(result.current.error).toBe(m.mergerNeedInstruments);
      act(() => {
        result.current.setFrom(A);
        result.current.setTo(B);
      });
      await act(() => result.current.submit(evt));
      expect(result.current.error).toBe(m.mergerNeedPortfolio);
      expect(client.createMerger).not.toHaveBeenCalled();
    });

    it("creates a merger with normalized quantities; market value only when taxable", async () => {
      const onSuccess = vi.fn();
      const { result, client } = setup({ portfolioId: "p1", onSuccess });
      act(() => {
        result.current.setFrom(A);
        result.current.setTo(B);
        result.current.setOutQty("1,5");
        result.current.setInQty("2");
        result.current.setExecutedAt("2026-05-06");
        result.current.setMarketValue("9,5");
      });
      await act(() => result.current.submit(evt));
      expect(client.createMerger).toHaveBeenLastCalledWith("p1", {
        fromInstrumentId: "i-a",
        toInstrumentId: "i-b",
        outQty: "1.5",
        inQty: "2",
        executedAt: new Date("2026-05-06"),
        taxable: false,
        marketValue: undefined,
      });
      act(() => result.current.setTaxable(true));
      await act(() => result.current.submit(evt));
      expect(client.createMerger).toHaveBeenLastCalledWith(
        "p1",
        expect.objectContaining({ taxable: true, marketValue: "9.5" }),
      );
      expect(onSuccess).toHaveBeenCalledTimes(2);
    });

    it("surfaces the merger error when the call fails", async () => {
      const { result } = setup({
        portfolioId: "p1",
        client: makeClient({
          createMerger: vi.fn(async () => {
            throw new Error("x");
          }),
        }),
      });
      act(() => {
        result.current.setFrom(A);
        result.current.setTo(B);
        result.current.setExecutedAt("2026-05-06");
      });
      await act(() => result.current.submit(evt));
      expect(result.current.error).toBe(m.mergerError);
    });
  });
});
