import { describe, it, expect, afterEach } from "vitest";
import { render as rtlRender, cleanup, screen, waitFor, act } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { Dialog, DialogContent, DialogTitle } from "../src/components/ui/dialog";
import { CommandDialog } from "../src/components/ui/command";

afterEach(cleanup);

const withIntl = (ui: ReactElement) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

/** A page-level button that has focus when a trigger-less dialog opens (keyboard shortcut). */
function Harness({ open, kind }: { open: boolean; kind: "dialog" | "command" }) {
  return (
    <>
      <button data-testid="page-button">page</button>
      {kind === "dialog" ? (
        <Dialog open={open} onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <input aria-label="inside" />
          </DialogContent>
        </Dialog>
      ) : (
        <CommandDialog open={open} onOpenChange={() => {}}>
          <input aria-label="inside" />
        </CommandDialog>
      )}
    </>
  );
}

describe.each(["dialog", "command"] as const)("focus restore on close (%s, no trigger)", (kind) => {
  it("returns focus to the element that had it when the dialog opened", async () => {
    const view = rtlRender(withIntl(<Harness open={false} kind={kind} />));
    const button = screen.getByTestId("page-button");
    act(() => button.focus());
    expect(button).toHaveFocus();

    view.rerender(withIntl(<Harness open kind={kind} />));
    await waitFor(() => expect(screen.getByLabelText("inside")).toBeInTheDocument());
    await waitFor(() => expect(button).not.toHaveFocus());

    view.rerender(withIntl(<Harness open={false} kind={kind} />));
    await waitFor(() => expect(screen.queryByLabelText("inside")).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
  });
});
