import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const refresh = vi.fn();
const listTransactions = vi.fn(async () => [
  {
    id: "tx1",
    portfolioId: "p1",
    instrumentId: "i1",
    type: "dividend",
    quantity: "100",
    price: "500000",
    fees: "0",
    tax: null,
    fxRate: null,
    description: null,
    tags: null,
    currency: "IDR",
    executedAt: "2025-07-15T00:00:00.000Z",
    source: "manual",
    kind: null,
    status: "normal",
    importId: null,
    externalId: null,
    instrument: { symbol: "BBCA", name: "Bank Central Asia", assetClass: "equity", unit: null },
    hasDocument: false,
  },
]);

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ listTransactions }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  IncomeEventsTable,
  type IncomeEventRow,
} from "../src/components/income/income-events-table";

const HISTORICAL: IncomeEventRow = {
  transactionId: "tx1",
  portfolioId: "p1",
  instrumentId: "i1",
  symbol: "BBCA",
  name: "Bank Central Asia",
  displayName: null,
  type: "dividend",
  date: "2025-07-15",
  amount: "500000",
  currency: "IDR",
};

const UPCOMING: IncomeEventRow = {
  instrumentId: "i2",
  symbol: "TLKM",
  name: "Telkom Indonesia",
  displayName: null,
  type: "dividend",
  date: "2026-08-20",
  amount: "300000",
  currency: "IDR",
  status: "projected",
};

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("IncomeEventsTable", () => {
  // The timeline renders both a desktop grid row and a mobile flex row (CSS hides one);
  // in jsdom both are in the DOM, so symbols appear more than once → use *AllByText.
  it("renders the instrument and its type for historical events", () => {
    wrap(<IncomeEventsTable rows={[HISTORICAL]} />);
    expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dividend").length).toBeGreaterThan(0);
    // No forecast markers on a received row.
    expect(screen.queryByText("est.")).not.toBeInTheDocument();
  });

  it("de-emphasises forecast payments with an est. tag and reduced opacity", () => {
    const { container } = wrap(<IncomeEventsTable rows={[UPCOMING]} />);
    expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
    // Forecast is conveyed by the "est." micro-tag (no separate status pill).
    expect(screen.getAllByText("est.").length).toBeGreaterThan(0);
    // The row wrapper carries opacity 0.78 (reference forecast de-emphasis).
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).some(
      (el) => el.style.opacity === "0.78",
    );
    expect(dimmed).toBe(true);
  });

  it("renders mixed historical and upcoming rows", () => {
    wrap(<IncomeEventsTable rows={[HISTORICAL, UPCOMING]} />);
    expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TLKM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("est.").length).toBeGreaterThan(0);
  });

  it("does not dim historical rows", () => {
    const { container } = wrap(<IncomeEventsTable rows={[HISTORICAL]} />);
    const dimmed = Array.from(container.querySelectorAll<HTMLElement>("[style]")).some(
      (el) => el.style.opacity === "0.78",
    );
    expect(dimmed).toBe(false);
  });

  it("clicking a received dividend row opens its transaction detail sheet", async () => {
    const { container } = wrap(<IncomeEventsTable rows={[HISTORICAL]} />);
    const row = container.querySelector('[role="button"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    await waitFor(() => expect(listTransactions).toHaveBeenCalledWith("p1"));
    // The sheet renders the linked transaction once loaded (symbol appears again in the sheet).
    await waitFor(() => expect(screen.getAllByText("BBCA").length).toBeGreaterThan(2));
  });

  it("forecast rows are not clickable (no backing transaction)", () => {
    const { container } = wrap(<IncomeEventsTable rows={[UPCOMING]} />);
    expect(container.querySelector('[role="button"]')).toBeNull();
  });
});

describe("IncomeEventsTable — groupByInstrument", () => {
  const rows: IncomeEventRow[] = [
    { ...HISTORICAL, instrumentId: "i1", symbol: "BBCA" },
    {
      instrumentId: "i1",
      symbol: "BBCA",
      name: "Bank Central Asia",
      displayName: null,
      type: "dividend",
      date: "2025-01-20",
      amount: "250000",
      currency: "IDR",
    },
    { ...UPCOMING, instrumentId: "i2", symbol: "TLKM" },
  ];

  it("renders one group header per instrument", () => {
    wrap(<IncomeEventsTable rows={rows} groupByInstrument />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
  });

  it("does not show child-row content when collapsed", () => {
    wrap(<IncomeEventsTable rows={rows} groupByInstrument />);
    // When collapsed, only group headers should be visible, not child-row content
    // like date text or type labels for individual rows
    expect(screen.queryByText("Jul 15")).not.toBeInTheDocument();
    expect(screen.queryByText("Jan 20")).not.toBeInTheDocument();
    expect(screen.queryByText("Aug 20")).not.toBeInTheDocument();
  });

  it("expands to show child rows on click", () => {
    wrap(<IncomeEventsTable rows={rows} groupByInstrument />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    const allBbca = screen.getAllByText("BBCA");
    expect(allBbca.length).toBeGreaterThanOrEqual(3);
  });

  it("shows total amount in the group header", () => {
    wrap(<IncomeEventsTable rows={rows} groupByInstrument />);
    expect(screen.getAllByText(/750,000/).length).toBeGreaterThan(0);
  });
});
