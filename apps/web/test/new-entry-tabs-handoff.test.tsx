import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const assistantMock = vi.hoisted(() => ({ available: true }));
vi.mock("@/components/assistant/assistant-provider", () => ({
  useAssistant: () => ({
    available: assistantMock.available,
    isOpen: false,
    open: () => {},
    close: () => {},
  }),
}));
// The forms are heavy and irrelevant here.
vi.mock("@/components/add-transaction", () => ({ AddTransaction: () => <div>tx-form</div> }));
vi.mock("@/components/record-corporate-action", () => ({
  RecordCorporateAction: () => <div>ca-form</div>,
}));

import { NewEntryTabs } from "@/components/new-entry-tabs";

const portfolios = [
  { id: "p1", name: "Main", brokerage: null, accountHolder: null },
  { id: "p2", name: "Savings", brokerage: null, accountHolder: null },
];

function renderTabs(props: Partial<React.ComponentProps<typeof NewEntryTabs>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NewEntryTabs
        portfolios={portfolios}
        initialPortfolioId="p2"
        value="transaction"
        onValueChange={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const label = messages.Assistant.handOff;

describe("NewEntryTabs hand-off button", () => {
  beforeEach(() => {
    assistantMock.available = true;
  });

  it("hands the selected portfolio to the caller", () => {
    const onAssistantHandOff = vi.fn();
    renderTabs({ onAssistantHandOff });
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onAssistantHandOff).toHaveBeenCalledWith(expect.objectContaining({ id: "p2" }));
  });

  it("is hidden when the assistant is not available", () => {
    assistantMock.available = false;
    renderTabs({ onAssistantHandOff: vi.fn() });
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  });

  it("is hidden when the caller offers no hand-off", () => {
    renderTabs();
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  });

  it("is not shown on the corporate-action tab", () => {
    renderTabs({ value: "corporate-action", onAssistantHandOff: vi.fn() });
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  });
});
