import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import type { HoldingValuation } from "@portfolio/api-client";

const routerPush = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: routerPush }),
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { PositionsPanel } from "../src/components/holdings/positions-panel";

const makeHolding = (
  symbol: string,
  name: string,
  assetClass: string,
  quantity = "10",
  avgCost = "100",
  instrumentId = symbol,
): HoldingValuation => ({
  instrumentId,
  quantity,
  avgCost,
  costBasis: String(Number(quantity) * Number(avgCost)),
  realizedPnL: "0",
  costCurrency: "IDR",
  price: "100",
  currency: "IDR",
  marketValue: String(Number(quantity) * 100),
  marketValueDisplay: String(Number(quantity) * 100),
  costBasisDisplay: String(Number(quantity) * Number(avgCost)),
  unrealizedPnL: "0",
  unrealizedPnLDisplay: "0",
  previousClose: null,
  dayChange: null,
  dayChangePct: null,
  instrument: {
    symbol,
    name,
    displayName: null,
    assetClass,
    unit: "shares",
    market: "IDX",
    sector: null,
    sectorWeights: null,
    countryWeights: null,
    country: null,
    industry: null,
  },
});

const ROWS: HoldingValuation[] = [
  makeHolding("BBCA", "Bank Central Asia", "equity", "100", "800"),
  makeHolding("AAPL", "Apple Inc.", "equity", "10", "1500"),
  makeHolding("BTC", "Bitcoin", "crypto", "1", "50000"),
];

function renderPanel(
  opts: {
    rows?: HoldingValuation[];
    cash?: Record<string, string>;
    classTabs?: readonly string[];
    actions?: React.ReactNode;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PositionsPanel
        rows={opts.rows ?? ROWS}
        currency="IDR"
        cash={opts.cash}
        classTabs={opts.classTabs ?? ["all", "equity", "crypto"]}
        actions={opts.actions}
      />
    </NextIntlClientProvider>,
  );
}

const t = messages.Holdings;

describe("PositionsPanel", () => {
  it("renders all rows with no query", () => {
    renderPanel();
    expect(screen.getAllByText("BBCA")[0]).toBeInTheDocument();
    expect(screen.getAllByText("AAPL")[0]).toBeInTheDocument();
    expect(screen.getAllByText("BTC")[0]).toBeInTheDocument();
  });

  it("filters rows by symbol", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "BBCA" },
    });
    expect(screen.getAllByText("BBCA")[0]).toBeInTheDocument();
    expect(screen.queryByText("AAPL")).toBeNull();
    expect(screen.queryByText("BTC")).toBeNull();
  });

  it("filters rows by name, case-insensitively", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "apple" },
    });
    expect(screen.getAllByText("AAPL")[0]).toBeInTheDocument();
    expect(screen.queryByText("BBCA")).toBeNull();
  });

  it("clearing the search via the X button restores all rows", () => {
    renderPanel();
    const input = screen.getByPlaceholderText(t.searchPlaceholder);
    fireEvent.change(input, { target: { value: "BBCA" } });
    expect(screen.queryByText("AAPL")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.searchClear }));
    expect(screen.getAllByText("AAPL")[0]).toBeInTheDocument();
    expect(screen.getAllByText("BTC")[0]).toBeInTheDocument();
  });

  it("composes search with the active asset-class tab", () => {
    renderPanel();
    // Switch to the "crypto" tab, then search for something only in "equity" — no rows
    // should match in that tab's TabsContent. Radix's TabsTrigger activates on
    // `mousedown` (see @radix-ui/react-tabs), not `click`, so use that event.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Crypto" }), { button: 0 });
    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "BBCA" },
    });
    expect(screen.getByText(t.noResults)).toBeInTheDocument();
  });

  it("shows noResults when the query matches nothing in a tab, but keeps every tab pill visible", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "xyznonexistent" },
    });
    expect(screen.getAllByText(t.noResults).length).toBeGreaterThan(0);
    // The chip row doesn't collapse/jump while a query is active.
    expect(screen.getByRole("tab", { name: "Stocks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Crypto" })).toBeInTheDocument();
  });

  it("filters the cash row by currency code and keeps it when the label matches", () => {
    renderPanel({ cash: { USD: "500", IDR: "0" } });
    // USD is the only non-zero balance — matches HoldingsTable's own zero-filtering.
    expect(screen.getAllByText("Cash")[0]).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "usd" },
    });
    expect(screen.getAllByText("Cash")[0]).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "cash" },
    });
    expect(screen.getAllByText("Cash")[0]).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "eur" },
    });
    expect(screen.queryByText("Cash")).toBeNull();
  });

  it("reflects the searched subset in the footer Total", () => {
    renderPanel();
    // Unfiltered: BBCA (100*100=10000) + AAPL (10*100=1000) + BTC (1*100=100) = 11100.
    expect(screen.getAllByText(/11,100/)[0]).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), {
      target: { value: "BBCA" },
    });
    // Filtered to BBCA only: 100 * 100 = 10,000.
    expect(screen.getAllByText(/10,000/)[0]).toBeInTheDocument();
  });

  it("renders the actions slot in the toolbar", () => {
    renderPanel({ actions: <button aria-label="Export CSV">Export</button> });
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });
});
