import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const push = vi.fn();
const globalSearch = vi.fn();
const suppressNextHistoryBack = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ globalSearch }),
}));
vi.mock("@/lib/back-to-close-stack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/back-to-close-stack")>();
  return {
    ...actual,
    // Delegate to the real function so the module-level `skipNextBack` flag actually
    // flips — the real `useBackToClose` cleanup effect calls the (unmocked)
    // `consumeSuppressedBack()` and reads the real flag. A pure spy would record the
    // call without mutating the flag, making the regression test pass for the wrong
    // reason (it would pass with the bug fix removed too).
    suppressNextHistoryBack: () => {
      actual.suppressNextHistoryBack();
      suppressNextHistoryBack();
    },
  };
});

import { GlobalSearch } from "../src/components/global-search";

const INSTRUMENT_RESULT = {
  id: "instr-1",
  symbol: "BBCA",
  name: "Bank Central Asia",
  market: "IDX",
  assetClass: "equity",
  currency: "IDR",
  isin: null,
  wkn: null,
  unit: "shares",
  sector: null,
  owned: true,
};

const CATALOG_RESULT = {
  id: "instr-2",
  symbol: "TLKM",
  name: "Telkom Indonesia",
  market: "IDX",
  assetClass: "equity",
  currency: "IDR",
  isin: null,
  wkn: null,
  unit: "shares",
  sector: null,
  owned: false,
};

const TX_RESULT = {
  id: "tx-1",
  portfolioId: "p-1",
  portfolioName: "Main",
  type: "buy",
  currency: "IDR",
  executedAt: "2026-01-15T00:00:00.000Z",
  description: "BBCA purchase",
  tags: null,
  instrument: { symbol: "BBCA", name: "Bank Central Asia" },
};

const s = messages.Search;

function renderSearch(holderId?: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GlobalSearch holderId={holderId} />
    </NextIntlClientProvider>,
  );
}

/** Open the palette and type a query, then advance all pending timers (debounce)
 *  AND flush the resulting promise. Returns after the component has re-rendered
 *  with search results (or empty state). */
async function openAndSearch(query: string) {
  fireEvent.click(screen.getByRole("button", { name: s.triggerLabel }));
  const input = screen.getByPlaceholderText(s.placeholder);
  fireEvent.change(input, { target: { value: query } });
  // runAllTimersAsync: fires the debounce setTimeout + drains the resulting promise.
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    push.mockClear();
    globalSearch.mockClear();
    suppressNextHistoryBack.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens when the trigger button is clicked", () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: s.triggerLabel }));
    expect(screen.getByPlaceholderText(s.placeholder)).toBeInTheDocument();
  });

  it("shows the hint text before any query is typed", () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: s.triggerLabel }));
    expect(screen.getByText(s.hint)).toBeInTheDocument();
  });

  it("calls globalSearch after debounce and renders instrument results", async () => {
    globalSearch.mockResolvedValue({
      instruments: [INSTRUMENT_RESULT],
      transactions: [],
    });

    renderSearch();
    await openAndSearch("BBCA");

    expect(globalSearch).toHaveBeenCalledWith({ q: "BBCA", holderId: undefined, limit: 10 });
    expect(screen.getByText("BBCA")).toBeInTheDocument();
    expect(screen.getByText("Bank Central Asia")).toBeInTheDocument();
  });

  it("renders transaction results with type and description", async () => {
    globalSearch.mockResolvedValue({
      instruments: [],
      transactions: [TX_RESULT],
    });

    renderSearch();
    await openAndSearch("purchase");

    expect(screen.getByText("BBCA purchase")).toBeInTheDocument();
  });

  it("shows 'no results' when the search returns empty", async () => {
    globalSearch.mockResolvedValue({ instruments: [], transactions: [] });

    renderSearch();
    await openAndSearch("zzz-nomatch");

    expect(screen.getByText(s.noResults)).toBeInTheDocument();
  });

  it("navigates to instrument page on instrument select", async () => {
    globalSearch.mockResolvedValue({
      instruments: [INSTRUMENT_RESULT],
      transactions: [],
    });

    renderSearch();
    await openAndSearch("BBCA");

    expect(screen.getByText("BBCA")).toBeInTheDocument();

    // Click the instrument result item. The symbol text is inside the item.
    fireEvent.click(screen.getByText("BBCA"));
    expect(push).toHaveBeenCalledWith("/instruments/instr-1");

    // Dialog closes after navigation (use real timers for waitFor).
    vi.useRealTimers();
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(s.placeholder)).not.toBeInTheDocument();
    });
  });

  it("navigates to transaction edit page on transaction select", async () => {
    globalSearch.mockResolvedValue({
      instruments: [],
      transactions: [TX_RESULT],
    });

    renderSearch();
    await openAndSearch("purchase");

    expect(screen.getByText("BBCA purchase")).toBeInTheDocument();

    fireEvent.click(screen.getByText("BBCA purchase"));
    expect(push).toHaveBeenCalledWith("/transactions/tx-1/edit");
  });

  it("shows a catalog badge for un-owned instruments", async () => {
    globalSearch.mockResolvedValue({
      instruments: [CATALOG_RESULT],
      transactions: [],
    });

    renderSearch();
    await openAndSearch("TLKM");

    expect(screen.getByText(s.catalogBadge)).toBeInTheDocument();
  });

  it("passes holderId to the search when provided", async () => {
    globalSearch.mockResolvedValue({ instruments: [], transactions: [] });

    renderSearch("holder-123");
    await openAndSearch("test");

    expect(globalSearch).toHaveBeenCalledWith({
      q: "test",
      holderId: "holder-123",
      limit: 10,
    });
  });

  it("does not call globalSearch when query is cleared to empty", async () => {
    globalSearch.mockResolvedValue({ instruments: [], transactions: [] });

    renderSearch();
    // Type a query and advance the debounce.
    await openAndSearch("BBCA");
    expect(globalSearch).toHaveBeenCalledTimes(1);

    // Clear the query.
    const input = screen.getByPlaceholderText(s.placeholder);
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // globalSearch should NOT have been called again for an empty query.
    expect(globalSearch).toHaveBeenCalledTimes(1);
    // The hint should reappear.
    expect(screen.getByText(s.hint)).toBeInTheDocument();
  });

  it("does not open on '/' when an input is focused", () => {
    renderSearch();

    // Simulate a focused input field.
    const externalInput = document.createElement("input");
    document.body.appendChild(externalInput);
    externalInput.focus();

    fireEvent.keyDown(document, { key: "/" });

    // Dialog should NOT open.
    expect(screen.queryByPlaceholderText(s.placeholder)).not.toBeInTheDocument();

    document.body.removeChild(externalInput);
  });

  it("opens on Cmd-K regardless of focus", () => {
    renderSearch();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByPlaceholderText(s.placeholder)).toBeInTheDocument();
  });

  it("calls suppressNextHistoryBack before navigation so useBackToClose won't undo the push", async () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    globalSearch.mockResolvedValue({
      instruments: [INSTRUMENT_RESULT],
      transactions: [],
    });

    renderSearch();
    await openAndSearch("BBCA");
    fireEvent.click(screen.getByText("BBCA"));

    // The suppression flag must be set BEFORE the dialog starts closing, so that
    // the `useBackToClose` cleanup effect (which runs after the open→closed render)
    // sees it and skips its `history.back()` — otherwise the marker entry on top of
    // the history stack is popped, silently cancelling the `router.push`. We assert
    // the actual outcome (`back()` not called) rather than just the call to the
    // suppression flag, because the mock delegates to the real flag-flipper and the
    // cleanup effect is unmocked.
    expect(push).toHaveBeenCalledWith("/instruments/instr-1");
    expect(backSpy).not.toHaveBeenCalled();
    expect(suppressNextHistoryBack).toHaveBeenCalledTimes(1);
    expect(suppressNextHistoryBack.mock.invocationCallOrder[0]).toBeLessThan(
      push.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    backSpy.mockRestore();
  });

  it("shows an error message when the search API rejects", async () => {
    globalSearch.mockRejectedValue(new Error("network down"));

    renderSearch();
    await openAndSearch("BBCA");

    expect(screen.getByText(s.error)).toBeInTheDocument();
    // Error must outrank "No results" — otherwise a 5xx is indistinguishable from
    // a clean empty match.
    expect(screen.queryByText(s.noResults)).not.toBeInTheDocument();
  });

  it("clears the error when a subsequent search succeeds", async () => {
    globalSearch
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ instruments: [INSTRUMENT_RESULT], transactions: [] });

    renderSearch();
    await openAndSearch("boom");
    expect(screen.getByText(s.error)).toBeInTheDocument();

    // Type a fresh query — the stale error should clear on the next runSearch.
    const input = screen.getByPlaceholderText(s.placeholder);
    fireEvent.change(input, { target: { value: "recover" } });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.queryByText(s.error)).not.toBeInTheDocument();
    expect(screen.getByText("BBCA")).toBeInTheDocument();
  });
});
