import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { SelectionBar } from "../src/components/transactions-table/selection-bar";

afterEach(cleanup);
const tb = messages.Transactions.batch;

function renderBar(over: Partial<React.ComponentProps<typeof SelectionBar>> = {}) {
  const props: React.ComponentProps<typeof SelectionBar> = {
    selectionMode: true,
    selectedCount: 0,
    selectedDraftCount: 0,
    canReassign: false,
    canMerge: false,
    busy: false,
    confirming: false,
    onClearSelection: vi.fn(),
    allSelected: false,
    onToggleAll: vi.fn(),
    matchingTotal: null,
    matchingLoading: false,
    onSelectMatching: vi.fn(),
    onBatchConfirmDrafts: vi.fn(),
    onBatchDiscardDrafts: vi.fn(),
    onReassign: vi.fn(),
    onMerge: vi.fn(),
    onRequestDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SelectionBar {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("SelectionBar select-all", () => {
  it("offers Select all even with nothing selected (the only entry point on mobile)", () => {
    const p = renderBar();
    fireEvent.click(screen.getByRole("button", { name: tb.selectAllLoaded }));
    expect(p.onToggleAll).toHaveBeenCalled();
  });

  it("flips to Deselect all once every loaded row is selected", () => {
    renderBar({ allSelected: true, selectedCount: 25 });
    expect(screen.getByRole("button", { name: tb.clearAll })).toBeInTheDocument();
  });

  it("shows 'Select all N matching' only when offered, and fires the handler", () => {
    const p = renderBar({ allSelected: true, selectedCount: 25, matchingTotal: 1083 });
    fireEvent.click(screen.getByRole("button", { name: "Select all 1083 matching" }));
    expect(p.onSelectMatching).toHaveBeenCalled();
  });

  it("hides the matching link when not offered", () => {
    renderBar({ allSelected: true, selectedCount: 25 });
    expect(screen.queryByRole("button", { name: /matching/ })).toBeNull();
  });

  it("hides select-all while confirming a delete", () => {
    renderBar({ confirming: true, selectedCount: 3 });
    expect(screen.queryByRole("button", { name: tb.selectAllLoaded })).toBeNull();
  });
});
