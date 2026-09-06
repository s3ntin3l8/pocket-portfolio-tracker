import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
