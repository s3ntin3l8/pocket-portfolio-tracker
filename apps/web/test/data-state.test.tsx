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
  // The unavailable state probes the API's health endpoint on mount. A pending stub
  // keeps the synchronous tests free of an out-of-act state update; the probe's own
  // tests replace it with an answering stub.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("requires an icon and copy only for the empty status", () => {
    // @ts-expect-error `icon` and `empty` are mandatory when status is "empty"
    const missing: React.ComponentProps<typeof DataState> = { status: "empty" };
    expect(missing.status).toBe("empty");
    // Failure states need neither.
    const failure: React.ComponentProps<typeof DataState> = { status: "unavailable" };
    expect(failure.status).toBe("unavailable");
  });

  it("renders unavailable with a Retry that refreshes the route", () => {
    renderState({ status: "unavailable" });
    expect(screen.getByText(messages.Empty.unavailableTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.DataState.retry }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reports our own API as the responder of the health probe", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ status: "healthy", service: "pocket-api" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderState({ status: "unavailable" });

    expect(await screen.findByText(/service=pocket-api/)).toBeInTheDocument();
    // The probe goes through the same-origin proxy, never straight to the API's address.
    expect(fetchMock).toHaveBeenCalledWith("/api/backend/health", expect.anything());
  });

  it("reports a foreign responder on the API's port", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        text: async () => JSON.stringify({ status: "healthy", service: "some-other-app" }),
      })),
    );
    renderState({ status: "unavailable" });

    // Not our API: the port is shadowed, which is what the empty request log means.
    expect(
      await screen.findByText(/service=some-other-app \(expected pocket-api\)/),
    ).toBeInTheDocument();
  });

  it("renders unauthorized as a session-expired state, not 'can't reach the API'", () => {
    renderState({ status: "unauthorized" });
    expect(screen.getByText(messages.DataState.unauthorizedTitle)).toBeTruthy();
    expect(screen.queryByText(messages.Empty.unavailableTitle)).toBeNull();
    expect(screen.getByRole("link", { name: messages.DataState.signIn })).toBeTruthy();
  });

  describe("rate_limited", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("counts down, disables Retry until the window passes, then retries", () => {
      renderState({ status: "rate_limited", retryAfter: 2 });
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
      renderState({ status: "rate_limited", retryAfter: null });
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
