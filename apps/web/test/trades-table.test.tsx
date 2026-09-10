import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
  legs: [],
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

const openWithRealized: Trade = {
  ...open,
  instrumentId: "i-partial",
  realizedPnL: "100",
  totalReturn: "2700",
  totalReturnPct: 0.06,
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
    symbol: "PARTIAL",
    name: "Partial",
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
    // Both desktop + mobile render in jsdom — the detail buttons appear twice (one
    // per breakpoint). Click the mobile card's detail button (second match).
    const detailButtons = screen.getAllByRole("button", { name: /detail/i });
    fireEvent.click(detailButtons[detailButtons.length - 1]);
    expect(screen.getByText(/Closed 2021-06-01/)).toBeInTheDocument();
  });

  it("opens the trade detail sheet from the mobile card for an open trade", () => {
    renderTable([open]);
    const detailButtons = screen.getAllByRole("button", { name: /detail/i });
    fireEvent.click(detailButtons[detailButtons.length - 1]);
    // Header reads "Open since {entryDate}" for open trades.
    expect(screen.getByText(/Open since 2021-02-01/)).toBeInTheDocument();
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

  describe("detail-sheet open via keyboard-reachable button", () => {
    it("opens the trade detail sheet via a keyboard-reachable button for a closed trade", () => {
      renderTable([closed]);
      fireEvent.click(screen.getAllByRole("button", { name: /detail/i })[0]);
      expect(screen.getByText(/Closed 2021-06-01/)).toBeInTheDocument();
    });

    it("opens the trade detail sheet for an open trade via the same button", () => {
      renderTable([open]);
      fireEvent.click(screen.getAllByRole("button", { name: /detail/i })[0]);
      // Open-trade header reads "Open since {entryDate}" (no realized exit).
      expect(screen.getByText(/Open since 2021-02-01/)).toBeInTheDocument();
    });

    it("does not render a leg-expand button for any trade (leg expansion was removed)", () => {
      renderTable([open, closed]);
      // The old expand/collapse legs labels no longer exist anywhere.
      expect(screen.queryByRole("button", { name: /legs/i })).toBeNull();
    });

    it("does not render a left-side chevron for an open trade", () => {
      renderTable([open]);
      // The old layout put a decorative ChevronRight at absolute -left-4 inside the
      // instrument cell for open trades; that element is gone. We assert absence of any
      // element positioned with `-left-` anywhere in the document.
      expect(document.querySelectorAll("[class*='-left-']").length).toBe(0);
    });
  });

  describe("open trade detail sheet content", () => {
    it("shows total return as hero for open trades (not realized P&L)", () => {
      renderTable([open]);
      fireEvent.click(screen.getAllByRole("button", { name: /detail/i })[0]);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getAllByText("Total return").length).toBeGreaterThanOrEqual(1);
      expect(within(dialog).queryByText("Realized P&L")).toBeNull();
    });

    it("shows realized P&L row in breakdown when open trade has interim partial sell", () => {
      renderTable([openWithRealized]);
      fireEvent.click(screen.getAllByRole("button", { name: /detail/i })[0]);
      const dialog = screen.getByRole("dialog");
      const realizedRows = within(dialog).getAllByText("Realized P&L");
      expect(realizedRows.length).toBe(1);
    });

    it("hides 'Income while held' card for open trades (dividends shown in breakdown instead)", () => {
      renderTable([open]);
      fireEvent.click(screen.getAllByRole("button", { name: /detail/i })[0]);
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).queryByText("Income while held")).toBeNull();
      expect(within(dialog).getByText("Dividends collected")).toBeInTheDocument();
    });
  });

  describe("long symbol names", () => {
    it("renders long symbol names fully visible inside the constrained symbol column", () => {
      const longSymbol: Trade = {
        ...closed,
        instrumentId: "i-long",
        instrument: {
          ...closed.instrument!,
          symbol: "ISHARES-CORE-MSCI-WORLD",
        },
      };
      renderTable([longSymbol]);
      // The symbol link should be in the DOM and its truncate class is fine — what
      // matters is the container width lets it breathe (180px, with Badge outside).
      // We assert the full symbol text is rendered (truncation is CSS-only).
      expect(screen.getAllByText("ISHARES-CORE-MSCI-WORLD").length).toBeGreaterThan(0);
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

  describe("P&L filter (gain/loss chips)", () => {
    const gainer: Trade = { ...closed, instrumentId: "i-win", totalReturn: "500" };
    const loser: Trade = {
      ...closed,
      instrumentId: "i-lose",
      totalReturn: "-200",
      instrument: { ...closed.instrument!, symbol: "LOSE" },
    };
    const neutral: Trade = {
      ...closed,
      instrumentId: "i-flat",
      totalReturn: "0",
      instrument: { ...closed.instrument!, symbol: "FLAT" },
    };

    function clickPnlChip(name: string) {
      // Two chip groups share "All"; disambiguate by scoping to the second one (P&L).
      const buttons = screen.getAllByRole("button", { name });
      const pnlAll = buttons[buttons.length - 1];
      fireEvent.click(pnlAll);
    }

    it("Gain chip hides losing trades", () => {
      renderTable([gainer, loser]);
      clickPnlChip("Gain");
      expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
      expect(screen.queryByText("LOSE")).toBeNull();
    });

    it("Loss chip hides winning trades", () => {
      renderTable([gainer, loser]);
      clickPnlChip("Loss");
      expect(screen.getAllByText("LOSE").length).toBeGreaterThan(0);
      expect(screen.queryByText("TLKM")).toBeNull();
    });

    it("neutral trades (totalReturn === 0) stay visible under both Gain and Loss", () => {
      // Number("") === 0 and open/partial rounding can produce totalReturn "0" or
      // "" — neutrals must not disappear from either chip's filtered view.
      renderTable([gainer, loser, neutral]);
      clickPnlChip("Gain");
      expect(screen.getAllByText("FLAT").length).toBeGreaterThan(0);
      clickPnlChip("Loss");
      expect(screen.getAllByText("FLAT").length).toBeGreaterThan(0);
    });

    it("the text-search query still filters neutrals (no early-return bypass)", () => {
      // The PnL filter must not skip the symbol/name search check on neutrals;
      // otherwise a mismatching query leaves neutrals visible.
      renderTable([gainer, loser, neutral]);
      clickPnlChip("Gain");
      fireEvent.change(screen.getByPlaceholderText("Search trades…"), {
        target: { value: "tlkm" },
      });
      expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
      expect(screen.queryByText("FLAT")).toBeNull();
    });
  });

  describe("year filter (entry OR exit)", () => {
    const crossYearTrade: Trade = {
      ...closed,
      instrumentId: "i-cross",
      entryDate: "2020-11-15",
      exitDate: "2021-02-15",
      totalReturn: "100",
      instrument: { ...closed.instrument!, symbol: "CROSS" },
    };
    const otherClosed: Trade = {
      ...closed,
      instrumentId: "i-other",
      entryDate: "2019-01-01",
      exitDate: "2019-06-01",
      totalReturn: "50",
      instrument: { ...closed.instrument!, symbol: "OTHER" },
    };
    const openCrossYear: Trade = {
      ...open,
      instrumentId: "i-open-cross",
      entryDate: "2022-12-10",
      exitDate: null,
      totalReturn: "500",
      instrument: { ...open.instrument!, symbol: "OPENCROSS" },
    };
    const otherOpen: Trade = {
      ...open,
      instrumentId: "i-open-other",
      entryDate: "2023-05-01",
      exitDate: null,
      totalReturn: "200",
      instrument: { ...open.instrument!, symbol: "OTHEROPEN" },
    };
    const sameYear: Trade = {
      ...closed,
      instrumentId: "i-same",
      entryDate: "2021-03-01",
      exitDate: "2021-04-01",
      instrument: { ...closed.instrument!, symbol: "SAME" },
    };

    function openYearMenu() {
      // Radix dropdown opens via keyboard/Enter, not a plain click+query.
      fireEvent.keyDown(screen.getByRole("button", { name: "Year" }), { key: "Enter" });
    }

    it("matches when entry year equals the filter, regardless of exit year", () => {
      renderTable([crossYearTrade, otherClosed]);
      openYearMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "2020" }));
      expect(screen.getAllByText("CROSS").length).toBeGreaterThan(0);
    });

    it("matches when exit year equals the filter, regardless of entry year", () => {
      renderTable([crossYearTrade, otherClosed]);
      openYearMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "2021" }));
      expect(screen.getAllByText("CROSS").length).toBeGreaterThan(0);
    });

    it("hides the trade when neither entry nor exit year matches", () => {
      // Dropdown options are derived from union of all entry/exit years across the
      // rendered rows — add a third trade so we get a year that CROSS can't match.
      const third: Trade = {
        ...closed,
        instrumentId: "i-third",
        entryDate: "2022-01-01",
        exitDate: "2022-12-31",
        instrument: { ...closed.instrument!, symbol: "THIRD" },
      };
      renderTable([crossYearTrade, sameYear, third]);
      openYearMenu();
      // CROSS's entry=2020, exit=2021 — picking 2022 hides it (neither matches).
      fireEvent.click(screen.getByRole("menuitem", { name: "2022" }));
      expect(screen.queryByText("CROSS")).toBeNull();
      expect(screen.getAllByText("THIRD").length).toBeGreaterThan(0);
    });

    it("includes open trades whose entry year matches", () => {
      // Two open trades from different years so the year dropdown appears.
      renderTable([openCrossYear, otherOpen]);
      openYearMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "2022" }));
      expect(screen.getAllByText("OPENCROSS").length).toBeGreaterThan(0);
      expect(screen.queryByText("OTHEROPEN")).toBeNull();
    });
  });
});
