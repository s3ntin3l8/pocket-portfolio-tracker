import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBackToClose } from "../src/lib/use-back-to-close";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useBackToClose", () => {
  it("no-ops for uncontrolled usage (open/onOpenChange undefined)", () => {
    const backSpy = vi.spyOn(window.history, "back");
    const pushSpy = vi.spyOn(window.history, "pushState");
    renderHook(() => useBackToClose(undefined, undefined));
    expect(backSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("pushes a marker on the closed->open transition", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const onOpenChange = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onOpenChange), {
      initialProps: { open: false },
    });
    expect(pushSpy).not.toHaveBeenCalled();

    rerender({ open: true });
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ backToCloseMarker: true }), "");
  });

  it("pops the marker via history.back() when closed normally (X/Save/Escape) with no interim navigation", () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const onOpenChange = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onOpenChange), {
      initialProps: { open: false },
    });
    rerender({ open: true }); // pushes the marker; window.history.state now has it

    rerender({ open: false }); // closed via X, not popstate
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  // Regression test: found live in the transactions filter Sheet — clicking "Clear all"
  // (a router.push while the Sheet is open) then closing via the X button silently
  // reverted the clear. Root cause: history.back() on close assumed nothing had pushed a
  // newer entry on top of our marker; when something did, popping landed back on the
  // marker's own stale pre-open URL instead of just removing the marker.
  it("does NOT call history.back() on close if something else navigated while open", () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const onOpenChange = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onOpenChange), {
      initialProps: { open: false },
    });
    rerender({ open: true }); // pushes the marker

    // Simulate a filter change's router.push while the sheet stays open — a real
    // navigation, not our marker (no backToCloseMarker flag on its state).
    window.history.pushState({}, "", "?year=2026");

    rerender({ open: false }); // closed via X
    expect(backSpy).not.toHaveBeenCalled();
  });

  it("closes the modal on popstate while a marker is pending, without calling history.back() again", () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const onOpenChange = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onOpenChange), {
      initialProps: { open: false },
    });
    rerender({ open: true }); // pushes the marker

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(backSpy).not.toHaveBeenCalled();
  });

  it("ignores a second popstate once the marker has already been consumed", () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onOpenChange), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    window.dispatchEvent(new PopStateEvent("popstate"));
    onOpenChange.mockClear();

    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
