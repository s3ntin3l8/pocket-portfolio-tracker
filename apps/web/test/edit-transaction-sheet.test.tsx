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

  it("renders a bottom Sheet on mobile — no Summary rail (desktop-only)", () => {
    mockMatchMedia(false);
    renderSheet();
    expect(screen.getByText(messages.Manage.tx.editTitle)).toBeInTheDocument();
    // vaul's Sheet is also `role="dialog"` under the hood, so the desktop/mobile split is
    // asserted via the Summary rail instead — desktop-only (`isDesktop` threaded into
    // AddTransactionForm), a much cleaner functional signal than DOM/attribute-sniffing.
    expect(screen.queryByText(messages.Manage.tx.summary)).toBeNull();
  });

  it("renders a centered 860px Dialog on desktop, with the Summary rail (v2 design)", () => {
    const matchMedia = mockMatchMedia(true);
    renderSheet();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(messages.Manage.tx.editTitle)).toBeInTheDocument();
    // The desktop-only Summary rail (see add-transaction-form/summary-rail.tsx).
    expect(screen.getByText(messages.Manage.tx.summary)).toBeInTheDocument();
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 860px)");
  });
});
