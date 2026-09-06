"use client";

import * as React from "react";
import {
  isMarkerRegistered,
  notePendingProgrammaticBack,
  registerMarker,
  releaseMarker,
} from "./back-to-close-stack";

/**
 * Makes the Android hardware/gesture back button close an open sheet/dialog instead of
 * navigating the route — installed PWAs have no browser chrome to fall back on, so
 * without this, back on an open modal exits the app or changes the page underneath it.
 *
 * Pattern: push a same-URL history entry when the modal opens (a "marker"), so the very
 * next back-navigation lands on it and fires `popstate` instead of leaving the page. On
 * `popstate` we close the modal — the browser has already consumed the marker entry, so
 * we don't call history APIs again. If the modal is instead closed some other way (X,
 * Save, Escape, overlay tap), we pop our own marker via `history.back()` so the stack
 * doesn't accumulate stale entries and a later real back-press behaves normally.
 *
 * Popping is conditional on THIS instance's marker still being the current history
 * entry (`history.state?.backToCloseMarkerId === id`, an id tag, not a bare boolean —
 * see the #671 doc block below for why identity matters once more than one instance
 * can be open). If content inside the modal did its own
 * `router.push`/`pushState` while open — e.g. a filter Sheet updating the URL as the
 * user picks chips without closing per tap — that navigation sits *on top of* our
 * marker. Blindly calling `history.back()` then would pop that interim entry instead of
 * the marker, silently reverting it back to the marker's stale pre-open URL (found live:
 * clearing filters in the transactions filter Sheet, then closing via the X button,
 * un-did the clear). When the marker isn't on top anymore, we leave it in the stack
 * instead — the cost is one extra back-press to fully leave the page later, which is far
 * better than discarding a navigation the user just made.
 *
 * No-ops for uncontrolled usage (`open`/`onOpenChange` undefined) and during SSR.
 *
 * Consumers that only ever mount the whole `Dialog`/`Sheet` tree once already-open
 * (`{trade && <Dialog open>...}` rather than an always-mounted `<Dialog open={open}>`,
 * e.g. `TradeDetailSheet`/`TransactionDetailSheet`) hit this hook's very first render
 * with `open` already `true`. `wasOpenRef` starts at `false` regardless of the initial
 * `open` value specifically so that first render still reads as a closed→open
 * transition and pushes a marker — starting it from `open` itself would make the push
 * effect see "was true, is true" on mount and skip pushing, silently leaving Android
 * back and future non-popstate closes with no marker to act on.
 *
 * With multiple Dialogs/Sheets/CommandDialogs open at once — the mobile add-menu's
 * chooser opening a nested portfolio/holder Dialog on top of itself, or Cmd/Ctrl-K's
 * global search opening over literally any other open overlay — every instance with a
 * pending marker used to react to the same `popstate`, closing all of them on one
 * back-press instead of just the topmost (#671). `back-to-close-stack.ts` coordinates
 * this across instances: each instance registers its marker there while pending, and a
 * single shared listener routes each real back-press to only the topmost registered
 * instance. See that module's doc comment for why this is module-level state rather
 * than React Context, and for the `pendingProgrammaticBacks` mechanism that also fixes a
 * second bug the naive "topmost in a stack" framing doesn't catch on its own: closing a
 * NON-topmost instance normally (X/Save/Escape) still calls `history.back()` for its own
 * marker, and the resulting `popstate` must not be misattributed to the user and used to
 * close whatever is now topmost.
 *
 * The pushed marker is tagged with THIS instance's own `id` (`backToCloseMarkerId`, not
 * a bare `backToCloseMarker: true` boolean) for the same multi-instance reason: with two
 * markers on the real history stack, a boolean can't tell "my own marker is current"
 * from "a DIFFERENT still-open instance's marker happens to be current" — and closing
 * while it's the latter must not call `history.back()` at all (that would consume the
 * OTHER instance's real history entry instead of leaving it alone, corrupting its
 * bookkeeping: that instance still believes its own marker is pending and will try to
 * pop it again on its own eventual close, over-popping by one).
 */
export function useBackToClose(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const id = React.useId();
  const pushedRef = React.useRef(false);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const enabled = onOpenChange !== undefined;

  // Push/pop the marker on the true open<->closed TRANSITION only — deliberately keyed
  // on `open`/`enabled` alone, never on the caller's `onOpenChange` identity. Most call
  // sites pass an inline callback that's a new reference on every render; keying on it
  // would re-run this effect (and push another marker) on every unrelated re-render
  // while the sheet just sits open, stacking history entries a single back-press can't
  // fully unwind.
  const wasOpenRef = React.useRef<boolean | undefined>(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !enabled) return;

    function onPop() {
      pushedRef.current = false;
      onOpenChangeRef.current?.(false);
    }

    // Self-heal a React Strict Mode dev remount: Strict Mode runs this effect's
    // cleanup (the unmount-release effect below) and re-runs this effect immediately,
    // simulating a real unmount+remount. The cleanup already released `id` from the
    // shared stack, but `pushedRef.current` survived (it's a ref, not reset by any
    // cleanup) — so without this, the marker stays in `window.history` with nothing in
    // the stack tracking it, and it would never get popped by anything. Idempotent:
    // `registerMarker` no-ops if `id` is already present, so this is a no-op on every
    // normal (non-remount) run of this effect.
    if (pushedRef.current && !isMarkerRegistered(id)) {
      registerMarker(id, onPop);
    }

    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (open && !wasOpen) {
      window.history.pushState({ ...window.history.state, backToCloseMarkerId: id }, "");
      pushedRef.current = true;
      registerMarker(id, onPop);
    } else if (!open && wasOpen && pushedRef.current) {
      pushedRef.current = false;
      releaseMarker(id);
      if (window.history.state?.backToCloseMarkerId === id) {
        notePendingProgrammaticBack();
        window.history.back();
      }
    }
  }, [open, enabled, id]);

  // Release on unmount without an explicit close (e.g. the parent stops rendering this
  // Dialog/Sheet entirely rather than setting `open` to false first) — otherwise the
  // shared stack would keep a dead instance's id, and a later back-press would route to
  // an `onPop` for a component that's already gone.
  React.useEffect(() => {
    if (typeof window === "undefined" || !enabled) return;
    return () => releaseMarker(id);
  }, [enabled, id]);
}
