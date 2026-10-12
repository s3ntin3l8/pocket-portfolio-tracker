import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Layers } from "lucide-react";
import messages from "../messages/en.json";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { DataState } from "../src/components/data-state";
import { classifyFailure, retryAfterOf } from "../src/lib/data-status";

function renderState(props: React.ComponentProps<typeof DataState>) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DataState {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refresh.mockReset();
});

describe("DataState", () => {
  it("renders the caller's copy for empty", () => {
    renderState({
      status: "empty",
      icon: Layers,
      empty: { title: "Nothing here", description: "Add something" },
    });
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders unavailable with a Retry that refreshes the route", () => {
    renderState({ status: "unavailable", icon: Layers });
    expect(screen.getByText(messages.Empty.unavailableTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.DataState.retry }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders unauthorized as a session-expired state, not 'can't reach the API'", () => {
    renderState({ status: "unauthorized", icon: Layers });
    expect(screen.getByText(messages.DataState.unauthorizedTitle)).toBeTruthy();
    expect(screen.queryByText(messages.Empty.unavailableTitle)).toBeNull();
    expect(screen.getByRole("link", { name: messages.DataState.signIn })).toBeTruthy();
  });

  describe("rate_limited", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("counts down, disables Retry until the window passes, then retries", () => {
      renderState({ status: "rate_limited", retryAfter: 2, icon: Layers });
      expect(screen.getByText(messages.DataState.rateLimitedTitle)).toBeTruthy();
      const waiting = screen.getByRole("button", { name: "Retry in 2s" }) as HTMLButtonElement;
      expect(waiting.disabled).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("button", { name: "Retry in 1s" })).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const ready = screen.getByRole("button", {
        name: messages.DataState.retry,
      }) as HTMLButtonElement;
      expect(ready.disabled).toBe(false);
      fireEvent.click(ready);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("falls back to generic copy when the API gave no wait time", () => {
      renderState({ status: "rate_limited", retryAfter: null, icon: Layers });
      expect(screen.getByText(messages.DataState.rateLimitedBodyNoTime)).toBeTruthy();
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    });
  });
});

describe("classifyFailure", () => {
  it("maps statuses onto the taxonomy", () => {
    expect(classifyFailure({ status: 401 })).toEqual({ status: "unauthorized" });
    expect(classifyFailure({ status: 429, retryAfter: 9 })).toEqual({
      status: "rate_limited",
      retryAfter: 9,
    });
    expect(classifyFailure({ status: 429 })).toEqual({ status: "rate_limited", retryAfter: null });
    expect(classifyFailure({ status: 500 })).toEqual({ status: "unavailable" });
    expect(classifyFailure(new Error("net"))).toEqual({ status: "unavailable" });
    expect(classifyFailure(null)).toEqual({ status: "unavailable" });
  });

  it("retryAfterOf reads only numeric retryAfter", () => {
    expect(retryAfterOf({ status: "rate_limited", retryAfter: 4 })).toBe(4);
    expect(retryAfterOf({ status: "unavailable" })).toBeNull();
  });
});
