import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { DesktopShell } from "../src/components/add-transaction-menu/desktop-shell";
import { useSheetFooterChrome } from "../src/components/ui/sheet";

function Probe() {
  const hasChrome = useSheetFooterChrome();
  return <span data-testid="chrome-probe">{hasChrome ? "styled" : "bare"}</span>;
}

function renderShell(props: Partial<React.ComponentProps<typeof DesktopShell>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DesktopShell
        open
        onOpenChange={vi.fn()}
        step="manual"
        onSelectStep={vi.fn()}
        headerTitle="Add transaction"
        centered
        onCancel={vi.fn()}
        {...props}
      >
        <Probe />
      </DesktopShell>
    </NextIntlClientProvider>,
  );
}

// Regression test: DesktopShell hand-rolls its own already-styled footer bar (border-t/
// bg/padding/justify-end) but never marked that via SheetFooterChromeContext — so a
// self-portaling child (SubmitButton, RecordCorporateActionForm, RecordMergerForm) read
// the context default (bare/false) and wrapped itself in the SAME chrome again, landing
// a doubled border/background next to the Cancel button on the desktop add-transaction
// menu, the exact bug useSheetFooterChrome exists to prevent.
describe("DesktopShell footer chrome", () => {
  it("marks its footer as already-styled when showFooter is true (the default)", () => {
    renderShell({ showFooter: true });
    expect(screen.getByTestId("chrome-probe")).toHaveTextContent("styled");
  });

  it("does not mark the footer as styled when showFooter is false (the import step)", () => {
    renderShell({ showFooter: false });
    expect(screen.getByTestId("chrome-probe")).toHaveTextContent("bare");
  });
});
