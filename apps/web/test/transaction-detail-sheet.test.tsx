import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const refresh = vi.fn();
const getTransactionDocumentUrl = vi.fn(async () => ({ url: "https://example.com/doc" }));
const deleteTransaction = vi.fn(async () => undefined);

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ getTransactionDocumentUrl, deleteTransaction }),
}));

import {
  TransactionDetailSheet,
} from "../src/components/transaction-detail-sheet";
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
  hasDocument: true,
};

function renderSheet(props: Partial<Parameters<typeof TransactionDetailSheet>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onDeleted = vi.fn();
  return {
    onOpenChange,
    onDeleted,
    ...render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TransactionDetailSheet
          tx={TX}
          open={true}
          onOpenChange={onOpenChange}
          onDeleted={onDeleted}
          {...props}
        />
      </NextIntlClientProvider>,
    ),
  };
}

describe("TransactionDetailSheet", () => {
  beforeEach(() => {
    refresh.mockClear();
    getTransactionDocumentUrl.mockClear();
    deleteTransaction.mockClear();
  });

  it("renders date, type, instrument symbol, quantity and currency when open", () => {
    renderSheet();
    // Date — formatted in medium style
    expect(screen.getByText(/Mar 15, 2026|15 Mar 2026/)).toBeInTheDocument();
    // Type badge — 'Buy' from TxType.buy
    expect(screen.getAllByText(messages.TxType.buy).length).toBeGreaterThan(0);
    // Instrument symbol
    expect(screen.getAllByText("BBCA").length).toBeGreaterThan(0);
    // Quantity
    expect(screen.getByText("10")).toBeInTheDocument();
    // Currency appears in the formatted amount
    expect(screen.getAllByText(/IDR/).length).toBeGreaterThan(0);
  });

  it("shows Download button when hasDocument=true, hides it when false", () => {
    const { rerender } = renderSheet();
    expect(
      screen.getByRole("button", { name: messages.Manage.downloadReceipt }),
    ).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TransactionDetailSheet
          tx={{ ...TX, hasDocument: false }}
          open={true}
          onOpenChange={vi.fn()}
          onDeleted={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.queryByRole("button", { name: messages.Manage.downloadReceipt }),
    ).toBeNull();
  });

  it("shows an Edit link pointing to /transactions/:id/edit", () => {
    renderSheet();
    const editLink = screen.getByRole("link", { name: messages.Manage.edit });
    expect(editLink).toHaveAttribute("href", "/transactions/tx-1/edit");
  });

  it("shows a Delete control", () => {
    renderSheet();
    // The DeleteTransactionButton renders a button with the delete label
    expect(
      screen.getByRole("button", { name: messages.Manage.delete.label }),
    ).toBeInTheDocument();
  });

  it("does not render the sheet content when open=false", () => {
    // Radix Dialog unmounts hidden content, so type badge should not appear
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TransactionDetailSheet
          tx={TX}
          open={false}
          onOpenChange={vi.fn()}
          onDeleted={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    // When closed, the dialog content is not mounted
    expect(screen.queryByText(messages.TxType.buy)).toBeNull();
  });

  it("calls download URL handler when Download button is clicked", async () => {
    renderSheet();
    const downloadBtn = screen.getByRole("button", { name: messages.Manage.downloadReceipt });
    fireEvent.click(downloadBtn);
    await waitFor(() => {
      expect(getTransactionDocumentUrl).toHaveBeenCalledWith("p-1", "tx-1");
    });
  });

  it("returns null when tx is null", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TransactionDetailSheet
          tx={null}
          open={true}
          onOpenChange={vi.fn()}
          onDeleted={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});
