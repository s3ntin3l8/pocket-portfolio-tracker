import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const refresh = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({
    searchInstruments: vi.fn(async () => []),
    lookupInstruments: vi.fn(async () => []),
    createInstrument: vi.fn(async () => ({})),
    createTransaction: vi.fn(async () => ({})),
    updateTransaction: vi.fn(async () => ({})),
    getGoldSources: vi.fn(async () => [{ market: "ANTAM", label: "Antam buyback" }]),
  }),
}));

import { EditTransactionSheet } from "../src/components/edit-transaction-sheet";
import type { TxRow } from "../src/components/transactions-table";

const TX: TxRow = {
  id: "tx-1",
  portfolioId: "p-1",
  portfolioName: "Main",
  type: "buy",
  quantity: "10",
  price: "100",
  fees: "5",
  tax: null,
  fxRate: null,
  currency: "IDR",
  executedAt: "2026-03-15T00:00:00.000Z",
  source: "manual",
  instrument: { symbol: "BBCA", name: "Bank Central Asia" },
  hasDocument: false,
};

function renderSheet() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EditTransactionSheet tx={TX} open={true} onOpenChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

/** Returns the mocked `matchMedia` fn so a test can assert what query it was called with. */
function mockMatchMedia(matches: boolean) {
  const fn = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  window.matchMedia = fn;
  return fn;
}

/** A `matchMedia` mock that can actually flip live, for testing what happens when
 *  `useMediaQuery` (a `useSyncExternalStore` subscription) crosses the breakpoint mid-render
 *  — `mockMatchMedia` above always returns a fixed value, which can't simulate a resize. */
function mockMatchMediaDynamic(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    resize(next: boolean) {
      matches = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

describe("EditTransactionSheet", () => {
  afterEach(() => {
    // Restore jsdom's default (matches: false) so later tests aren't affected.
    mockMatchMedia(false);
  });

  // Overlay chrome migration (#625): a single DialogContent tree now, full-screen on
  // mobile, a centered size="lg" card at md:+ — the "Edit transaction" title
  // legitimately renders twice (mobile header h1 + desktop DialogTitle, CSS-hidden per
  // viewport, not conditionally mounted). AddTransactionForm's own isDesktop-driven
  // internal layout (Summary rail or not) is untouched and still reads the same media
  // query, since that's a different, in-scope-elsewhere concern from the overlay chrome.
  it("renders full-screen on mobile — no Summary rail (AddTransactionForm's own isDesktop layout)", () => {
    mockMatchMedia(false);
    renderSheet();
    expect(screen.getAllByText(messages.Manage.tx.editTitle).length).toBeGreaterThan(0);
    expect(screen.queryByText(messages.Manage.tx.summary)).toBeNull();
  });

  it("renders a centered lg (880px) card on desktop, with the Summary rail (v2 design)", () => {
    const matchMedia = mockMatchMedia(true);
    renderSheet();
    const content = screen.getByRole("dialog");
    expect(content.className).toContain("md:max-w-[880px]");
    expect(screen.getAllByText(messages.Manage.tx.editTitle).length).toBeGreaterThan(0);
    // The desktop-only Summary rail (see add-transaction-form/summary-rail.tsx).
    expect(screen.getByText(messages.Manage.tx.summary)).toBeInTheDocument();
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 860px)");
  });

  it("keeps the submit button in DialogContent's persistent footer", () => {
    renderSheet();
    const submitBtn = screen.getByRole("button", { name: messages.Manage.tx.save });
    expect(submitBtn.closest('[data-slot="dialog-footer"]')).not.toBeNull();
  });

  // Regression test: SubmitButton used to decide bare-vs-wrapped portaling from its own
  // `isDesktop` prop, which on mobile always wrapped it in a `border-t bg-background`
  // div — doubling the chrome DialogContent's own footer bar already supplies. Fixed by
  // keying that decision on useSheetFooterChrome() (the host) instead. The button should
  // now be a direct child of the footer bar, not nested inside an extra wrapper div.
  it("portals the submit button bare, not wrapped in its own border/background div", () => {
    renderSheet();
    const submitBtn = screen.getByRole("button", { name: messages.Manage.tx.save });
    expect(submitBtn.closest('[data-slot="dialog-footer"]')).not.toBeNull();
    // The button's immediate parent should only be DialogContent's own `display:contents`
    // portal-target div — not an extra `border-t bg-background` wrapper of its own.
    expect(submitBtn.parentElement?.className ?? "").not.toContain("border-t");
  });

  // The regression test for the migration's whole premise (see the plan's "Why
  // single-tree CSS is the load-bearing part" section): before, EditTransactionSheet
  // picked between two component trees via `{isDesktop ? <Dialog/> : <Sheet/>}`, so
  // crossing the breakpoint unmounted the open one and mounted the other — taking
  // AddTransactionForm's state with it. Now there's one DialogContent tree and
  // `isDesktop` only reaches AddTransactionForm as a reactive layout prop, so the form
  // itself never unmounts and a typed value survives the resize.
  it("keeps a typed field value across a resize past the breakpoint", () => {
    const media = mockMatchMediaDynamic(false);
    renderSheet();

    const qtyInput = screen.getByLabelText(messages.Manage.tx.quantity);
    expect(qtyInput).toHaveValue("10"); // TX.quantity, prefilled
    fireEvent.change(qtyInput, { target: { value: "777" } });
    expect(qtyInput).toHaveValue("777");

    // Cross the breakpoint. If this were still two trees, the field above would have
    // unmounted along with the mobile Sheet and remounted fresh from `initial` (back to
    // "10") inside a new desktop Dialog instance.
    media.resize(true);

    // The desktop-only Summary rail proves the resize actually took effect, not just a
    // no-op mock call. The field's *value* is what has to survive — PricingFields'
    // surrounding grid legitimately re-lays-out between mobile/desktop (isDesktop is a
    // real prop change, not nothing), so the input DOM node itself isn't asserted
    // identical, only the state it displays: still "777", not reset to "10".
    expect(screen.getByText(messages.Manage.tx.summary)).toBeInTheDocument();
    expect(screen.getByLabelText(messages.Manage.tx.quantity)).toHaveValue("777");
  });
});
