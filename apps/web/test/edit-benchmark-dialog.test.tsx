/**
 * The benchmark dialog's instrument search is debounced. The debounce must never
 * outlive the component: a timer that fires into a torn-down environment updates
 * state on a component that is gone, and in the test suite it raises an unhandled
 * "window is not defined" that fails the whole run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";

const { lookupInstruments } = vi.hoisted(() => ({
  lookupInstruments: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ lookupInstruments }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { EditBenchmarkDialog } from "../src/components/insights/edit-benchmark-dialog";

const t = messages.Insights.benchmark;

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EditBenchmarkDialog open onOpenChange={vi.fn()} currentSymbols={[]} />
    </NextIntlClientProvider>,
  );
}

const typeQuery = (q: string) =>
  fireEvent.change(screen.getByLabelText(t.searchBenchmark), { target: { value: q } });

describe("EditBenchmarkDialog — the debounced search", () => {
  beforeEach(() => {
    lookupInstruments.mockClear();
  });

  it("runs the search after the debounce", async () => {
    vi.useFakeTimers();
    try {
      renderDialog();
      typeQuery("spx");
      expect(lookupInstruments).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(lookupInstruments).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the pending search when the query is emptied", async () => {
    vi.useFakeTimers();
    try {
      renderDialog();
      typeQuery("spx");
      typeQuery("");

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      // The previous search must not fire once the query is gone.
      expect(lookupInstruments).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run the pending search after unmount", async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderDialog();
      typeQuery("spx");

      unmount();

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(lookupInstruments).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
