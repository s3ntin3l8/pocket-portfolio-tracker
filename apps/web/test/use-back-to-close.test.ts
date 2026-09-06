import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBackToClose } from "../src/lib/use-back-to-close";
import { resetBackToCloseStackForTests } from "../src/lib/back-to-close-stack";

// This repo's vitest config shares the module registry across every test within a file
// (`isolate` resets per file, not per test) — required so a leftover stack entry,
// pending-back counter, or attached popstate listener from one test can't leak into the
// next.
beforeEach(() => {
  resetBackToCloseStackForTests();
});

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
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({ backToCloseMarkerId: expect.any(String) }),
      "",
    );
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
    // navigation, not our marker (no backToCloseMarkerId on its state).
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

  // Regression test: found by review — TradeDetailSheet/TransactionDetailSheet render
  // `if (!trade) return null` *before* their <Dialog>, and their callers pass
  // `open={detailTrade !== null}` alongside `trade={detailTrade}` — so the Dialog (and
  // this hook) only ever mounts for the first time already `open: true`, never through a
  // false->true transition on an always-mounted instance. `wasOpenRef` used to
  // initialize from `open` itself, so that first render read as "was true, is true" and
  // skipped the push entirely, leaving Android back (and any later non-popstate close)
  // with no marker to act on for either of the app's two most-used detail overlays.
  it("pushes a marker even when the hook's first render is already open (conditionally-mounted overlay)", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const onOpenChange = vi.fn();
    renderHook(() => useBackToClose(true, onOpenChange));

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(
      expect.objectContaining({ backToCloseMarkerId: expect.any(String) }),
      "",
    );
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

  // Regression tests for #671: with multiple Dialog/Sheet/CommandDialog instances open
  // at once (the mobile add-menu's chooser opening a nested portfolio/holder Dialog on
  // top of itself; Cmd/Ctrl-K opening over any other open overlay), every instance with
  // a pending marker used to independently react to the same popstate, closing all of
  // them on one back-press instead of just the topmost.
  describe("multiple concurrent instances (#671)", () => {
    it("one back-press closes only the topmost (most-recently-opened) instance", () => {
      const onOpenChangeA = vi.fn();
      const onOpenChangeB = vi.fn();
      const { rerender: rerenderA } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeA),
        {
          initialProps: { open: false },
        },
      );
      rerenderA({ open: true }); // A opens first

      const { rerender: rerenderB } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeB),
        {
          initialProps: { open: false },
        },
      );
      rerenderB({ open: true }); // B opens on top of A

      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(onOpenChangeB).toHaveBeenCalledWith(false);
      expect(onOpenChangeA).not.toHaveBeenCalled();
    });

    it("a second back-press then closes the instance beneath it", () => {
      const onOpenChangeA = vi.fn();
      const onOpenChangeB = vi.fn();
      const { rerender: rerenderA } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeA),
        {
          initialProps: { open: false },
        },
      );
      rerenderA({ open: true });

      const { rerender: rerenderB } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeB),
        {
          initialProps: { open: false },
        },
      );
      rerenderB({ open: true });

      window.dispatchEvent(new PopStateEvent("popstate")); // closes B
      rerenderB({ open: false }); // parent reacts to onOpenChangeB(false)

      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(onOpenChangeA).toHaveBeenCalledWith(false);
    });

    // Closing A (buried underneath B, opened first) must NOT call history.back(): B's
    // marker is the current history entry, not A's, and popping it would consume B's
    // real entry instead of leaving it alone — corrupting B's own bookkeeping (B still
    // believes its marker is pending and would try to pop it again on its own eventual
    // close, over-popping by one). A's own marker is left in place rather than
    // "orphaned" in the sense of being lost — it's still the entry a later back-press
    // (after B closes) will correctly consume, one silent extra back-press to fully
    // leave the page, the same accepted trade-off as the interim-navigation case above.
    it("closing a non-topmost instance via X does not call history.back() (its own marker isn't current)", () => {
      const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const onOpenChangeA = vi.fn();
      const onOpenChangeB = vi.fn();
      const { rerender: rerenderA } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeA),
        {
          initialProps: { open: false },
        },
      );
      rerenderA({ open: true });

      const { rerender: rerenderB } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeB),
        {
          initialProps: { open: false },
        },
      );
      rerenderB({ open: true });

      // Close A (opened first, buried underneath B) via X — not a back-press.
      rerenderA({ open: false });

      expect(backSpy).not.toHaveBeenCalled();
      expect(onOpenChangeB).not.toHaveBeenCalled();
    });

    // The bug this whole fix is for, beyond "one back-press closes both": closing the
    // TOPMOST instance via X (not a back-press) still calls history.back() for its own
    // marker, and the resulting popstate must not be misattributed to a user back-press
    // that closes whatever is now topmost.
    it("closing the topmost instance via X does not close the instance beneath it", () => {
      const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const onOpenChangeA = vi.fn();
      const onOpenChangeB = vi.fn();
      const { rerender: rerenderA } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeA),
        {
          initialProps: { open: false },
        },
      );
      rerenderA({ open: true });

      const { rerender: rerenderB } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeB),
        {
          initialProps: { open: false },
        },
      );
      rerenderB({ open: true });

      rerenderB({ open: false }); // close B (topmost) via X
      expect(backSpy).toHaveBeenCalledTimes(1);

      // The real history.back() this triggered would produce a popstate — simulate it.
      window.dispatchEvent(new PopStateEvent("popstate"));

      expect(onOpenChangeA).not.toHaveBeenCalled();
    });

    // transactions-table.tsx's TransactionDetailSheet -> EditTransactionSheet handoff
    // (`setDetailTx(null); setEditTx(tx)` in one batch) pops one marker and pushes
    // another in the same tick. Parameterized over both possible effect orderings so
    // the fix doesn't accidentally depend on which sibling's effect runs first.
    it("same-tick close-then-open handoff leaves the newly-opened instance open (closing effect runs first)", () => {
      const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const onOpenChangeD = vi.fn();
      const onOpenChangeE = vi.fn();
      const { rerender: rerenderD } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeD),
        {
          initialProps: { open: false },
        },
      );
      rerenderD({ open: true });

      const hookE = renderHook(({ open }) => useBackToClose(open, onOpenChangeE), {
        initialProps: { open: false },
      });

      rerenderD({ open: false }); // D's effect runs first: releases + history.back()
      hookE.rerender({ open: true }); // E's effect runs second: opens

      expect(backSpy).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new PopStateEvent("popstate")); // D's queued back() arrives

      expect(onOpenChangeE).not.toHaveBeenCalled();
    });

    // Unlike the "closing effect runs first" case above, here E opens WHILE D is still
    // open (D closes second) — so by the time D closes, E's marker (not D's own) is the
    // current history entry, and D must NOT call history.back() for the same reason as
    // the non-topmost-close test below: popping would consume E's real entry instead of
    // D's own. D's own marker is left in place (the same one-extra-silent-back-press
    // trade-off), and there's no queued history.back() for a later popstate to consume
    // — E is simply never touched by any of this.
    it("same-tick close-then-open handoff: D closing after E has already opened does not call history.back()", () => {
      const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const onOpenChangeD = vi.fn();
      const onOpenChangeE = vi.fn();
      const { rerender: rerenderD } = renderHook(
        ({ open }) => useBackToClose(open, onOpenChangeD),
        {
          initialProps: { open: false },
        },
      );
      rerenderD({ open: true });

      const hookE = renderHook(({ open }) => useBackToClose(open, onOpenChangeE), {
        initialProps: { open: false },
      });

      hookE.rerender({ open: true }); // E opens while D is still open
      rerenderD({ open: false }); // D closes second — E's marker, not D's, is current

      expect(backSpy).not.toHaveBeenCalled();
      expect(onOpenChangeE).not.toHaveBeenCalled();
    });
  });

  // Regression test: found by review — React Strict Mode (on in this repo's
  // next.config.mjs) simulates a mount->cleanup->remount cycle for every effect. The
  // hook's push effect has a reconcile specifically to survive this (re-registering with
  // the shared stack if pushedRef is already true but the id was released by the
  // simulated unmount) — without it, the marker would sit in window.history with
  // nothing tracking it, and no back-press or close would ever pop it.
  it("pushes exactly one marker under React Strict Mode's double-invoked effects", () => {
    const pushSpy = vi.spyOn(window.history, "pushState");
    const onOpenChange = vi.fn();
    const { rerender } = renderHook(({ open }) => useBackToClose(open, onOpenChange), {
      initialProps: { open: false },
      wrapper: StrictMode,
    });

    rerender({ open: true });

    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});
