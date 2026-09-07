import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const routerPush = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  Link: ({ children, onClick }: { children: React.ReactNode; onClick?: (e: unknown) => void }) => (
    <a onClick={onClick}>{children}</a>
  ),
}));

import { TradesTable } from "../src/components/trades-table";
import type { Trade } from "@portfolio/api-client";

const closed: Trade = {
  instrumentId: "i-tlkm",
  currency: "EUR",
  status: "closed",
  entryDate: "2021-01-01",
  exitDate: "2021-06-01",
  holdingDays: 151,
  avgHoldingDays: 151,
  longTerm: false,
  quantity: "10",
  avgEntryPrice: "100",
  avgExitPrice: "130",
  invested: "1000",
  realizedPnL: "300",
  unrealizedPnL: "0",
  dividends: "0",
  totalReturn: "300",
  totalReturnPct: 0.3,
  annualizedPct: 0.7,
  legs: [
    {
      acqDate: "2021-01-01",
      sellDate: "2021-06-01",
      quantity: "10",
      cost: "1000",
      proceeds: "1300",
      gain: "300",
      holdingDays: 151,
      longTerm: false,
      taxYear: 2021,
    },
  ],
  instrument: {
    symbol: "TLKM",
    name: "Telkom",
    displayName: null,
    assetClass: "equity",
    unit: "shares",
    market: "IDX",
    sector: null,
    sectorWeights: null,
    countryWeights: null,
    country: null,
    industry: null,
  },
};

const open: Trade = {
  instrumentId: "i-bbca",
  currency: "EUR",
  status: "open",
  entryDate: "2021-02-01",
  exitDate: null,
  holdingDays: 800,
  avgHoldingDays: 800,
  longTerm: true,
  quantity: "5",
  avgEntryPrice: "9000",
  avgExitPrice: null,
  invested: "45000",
  realizedPnL: "0",
  unrealizedPnL: "2500",
  dividends: "100",
  totalReturn: "2600",
  totalReturnPct: 0.0578,
  annualizedPct: null,
  // An interim partial sell before the position fully closed — still an "open" trade,
  // but it carries a leg (used to exercise the inline row-expansion below).
  legs: [
    {
      acqDate: "2021-02-01",
      sellDate: "2021-03-01",
      quantity: "2",
      cost: "400",
      proceeds: "500",
      gain: "100",
      holdingDays: 28,
      longTerm: false,
      taxYear: 2021,
    },
  ],
  instrument: {
    symbol: "BBCA",
    name: "BCA",
    displayName: null,
    assetClass: "equity",
    unit: "shares",
    market: "IDX",
    sector: null,
    sectorWeights: null,
    countryWeights: null,
    country: null,
    industry: null,
  },
};

function renderTable(trades: Trade[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TradesTable trades={trades} currency="EUR" />
    </NextIntlClientProvider>,
  );
}

describe("TradesTable", () => {
  it("renders open and closed trades with their total return", () => {
    renderTable([open, closed]);
    expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    // The long-term (tax-free) flag surfaces on the open position held > 1 year.
    expect(screen.getAllByText(/Tax-free/).length).toBeGreaterThan(0);
  });

  it("opens the trade detail sheet from the mobile card for a closed trade", () => {
    renderTable([closed]);
    // Both the desktop table and mobile list render in jsdom (Tailwind's responsive
    // classes don't hide elements without real CSS) — the mobile occurrence is the
    // second "TLKM" link, and clicking it bubbles to the card's onClick.
    fireEvent.click(screen.getAllByText("TLKM")[1]);
    expect(screen.getByText(/Closed 2021-06-01/)).toBeInTheDocument();
  });

  describe("status chips + search", () => {
    it("shows every trade under the 'All' chip by default", () => {
      renderTable([open, closed]);
      expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
      expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
    });

    it("filters to open trades only", () => {
      renderTable([open, closed]);
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
      expect(screen.queryByText("TLKM")).toBeNull();
    });

    it("filters to closed trades only", () => {
      renderTable([open, closed]);
      fireEvent.click(screen.getByRole("button", { name: "Closed" }));
      expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
      expect(screen.queryByText("BBCA")).toBeNull();
    });

    it("narrows rows by search text (symbol match)", () => {
      renderTable([open, closed]);
      fireEvent.change(screen.getByPlaceholderText("Search trades…"), {
        target: { value: "tlkm" },
      });
      expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
      expect(screen.queryByText("BBCA")).toBeNull();
    });

    it("shows an empty-filters message when nothing matches", () => {
      renderTable([open, closed]);
      fireEvent.change(screen.getByPlaceholderText("Search trades…"), {
        target: { value: "nonexistent" },
      });
      expect(screen.getByText("No trades match your filters.")).toBeInTheDocument();
      expect(screen.queryByText("BBCA")).toBeNull();
      expect(screen.queryByText("TLKM")).toBeNull();
    });

    it("clears the search query via the clear button", () => {
      renderTable([open, closed]);
      const input = screen.getByPlaceholderText("Search trades…");
      fireEvent.change(input, { target: { value: "tlkm" } });
      expect(screen.queryByText("BBCA")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    });
  });

  describe("leg expansion via keyboard-reachable button", () => {
    it("expands an open trade to reveal its matched legs via a keyboard-reachable button", () => {
      renderTable([open]);
      // Leg detail is hidden until the row is expanded.
      expect(screen.queryByText("2021-02-01 → 2021-03-01")).toBeNull();
      // The whole-row onClick is gone — the only keyboard-reachable trigger is the
      // dedicated button in the symbol cell.
      fireEvent.click(screen.getByRole("button", { name: /legs/i }));
      expect(screen.getByText("2021-02-01 → 2021-03-01")).toBeTruthy();
    });

    it("collapses an open trade to hide its matched legs via the same button", () => {
      renderTable([open]);
      const button = screen.getByRole("button", { name: /legs/i });
      fireEvent.click(button);
      expect(screen.getByText("2021-02-01 → 2021-03-01")).toBeTruthy();
      fireEvent.click(button);
      expect(screen.queryByText("2021-02-01 → 2021-03-01")).toBeNull();
    });

    it("toggles the button's aria-label between expand and collapse", () => {
      renderTable([open]);
      const button = screen.getByRole("button", { name: /show.*legs|legs/i });
      // Initially collapsed → the label advertises the expand action.
      expect(button.getAttribute("aria-label")).toMatch(/show|expand/i);
      fireEvent.click(button);
      expect(button.getAttribute("aria-label")).toMatch(/hide|collapse/i);
    });

    it("does not render a leg-expand button for a closed trade", () => {
      renderTable([closed]);
      expect(screen.queryByRole("button", { name: /legs/i })).toBeNull();
    });

    it("does not render a leg-expand button for an open trade with no legs", () => {
      const openNoLegs: Trade = { ...open, legs: [] };
      renderTable([openNoLegs]);
      expect(screen.queryByRole("button", { name: /legs/i })).toBeNull();
    });
  });

  describe("detail-sheet open via keyboard-reachable button", () => {
    it("opens the trade detail sheet via a keyboard-reachable button for a closed trade", () => {
      renderTable([closed]);
      // Whole-row onClick is gone — the only keyboard-reachable trigger is a dedicated
      // button. Sheet header reads "Closed 2021-06-01".
      fireEvent.click(screen.getByRole("button", { name: /detail/i }));
      expect(screen.getByText(/Closed 2021-06-01/)).toBeInTheDocument();
    });

    it("does not render a detail button for an open trade (open trades use leg expansion instead)", () => {
      renderTable([open]);
      expect(screen.queryByRole("button", { name: /detail/i })).toBeNull();
    });
  });

  describe("keyboard accessibility", () => {
    it("renders exactly one focusable anchor per collapsed row (the per-cell instrument link)", () => {
      renderTable([open, closed]);
      const dataRows = screen.getAllByRole("row").filter((r) => r.querySelector("a[onclick], a"));
      // Both trade rows should be present.
      expect(dataRows.length).toBeGreaterThan(0);
      for (const row of dataRows) {
        const anchors = row.querySelectorAll("a");
        expect(anchors.length, `row ${row.textContent}`).toBe(1);
      }
    });

    it("does not push any route when a non-link cell is clicked on the desktop row", () => {
      routerPush.mockClear();
      renderTable([closed]);
      const row = screen.getAllByRole("row")[1];
      // Click the period cell — not the link.
      fireEvent.click(row.querySelectorAll("td")[1]);
      expect(routerPush).not.toHaveBeenCalled();
    });
  });
});
