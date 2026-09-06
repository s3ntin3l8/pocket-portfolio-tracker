/**
 * Module-level coordination for `useBackToClose` (see that file for the marker/history
 * pattern this backs). Every mounted `Dialog`/`Sheet`/`CommandDialog` instance registers
 * one entry here while its history marker is pending, so a single back-press can be
 * routed to whichever instance is actually topmost — instead of every instance with a
 * pending marker independently reacting to the same `popstate` event (#671).
 *
 * Deliberately module-level state, not React Context: `useBackToClose`'s three call
 * sites (`Dialog`, `Sheet`, `CommandDialog`) need this to work identically regardless of
 * where in the tree they render, including outside `AppShell` — the `@modal` parallel
 * route, `/onboarding`, `/auth-error` — where a Context provider mounted in `AppShell`
 * (the pattern `full-screen-overlay.tsx` uses for an adjacent problem) wouldn't reach at
 * all. `window.history` is itself a browser-global singleton; coordinating access to it
 * through React state would be an impedance mismatch for no benefit, since nothing here
 * renders from this state. Every mutation happens only inside effects that already guard
 * `typeof window === "undefined"`, so this is never touched during SSR.
 *
 * A single, page-lifetime `popstate` listener (not one per instance) attributes each
 * event by CAUSE, not by stack position: closing a non-topmost instance normally (X,
 * Save, Escape) still calls `history.back()` for its own marker, and that back-press
 * must not be misread as a user-initiated back that should close the new topmost
 * instance. `pendingProgrammaticBacks` tracks exactly that — incremented immediately
 * before every `history.back()` this module causes, decremented (and the event
 * swallowed) by the first `popstate` that arrives afterward. Only once the counter is
 * back at zero does an incoming `popstate` mean "the user actually pressed back," at
 * which point the topmost registered instance closes.
 */

interface MarkerEntry {
  id: string;
  onPop: () => void;
}

let stack: MarkerEntry[] = [];
let pendingProgrammaticBacks = 0;
let listenerAttached = false;

function handlePopState() {
  if (pendingProgrammaticBacks > 0) {
    // We caused this via our own history.back() (releasing a non-topmost instance's
    // marker) — not a real user back-press. Nobody closes.
    pendingProgrammaticBacks -= 1;
    return;
  }
  // LIFO: the last-registered (topmost) entry is the end of the array.
  const top = stack.pop();
  top?.onPop();
}

function ensureListenerAttached() {
  if (listenerAttached || typeof window === "undefined") return;
  window.addEventListener("popstate", handlePopState);
  listenerAttached = true;
}

/** Idempotent — re-registering an id already on the stack is a no-op (used by the
 *  StrictMode-remount reconcile in `useBackToClose`, which can't tell in advance
 *  whether it's re-registering or registering for the first time). */
export function registerMarker(id: string, onPop: () => void) {
  if (typeof window === "undefined") return;
  if (stack.some((entry) => entry.id === id)) return;
  stack.push({ id, onPop });
  ensureListenerAttached();
}

/** Idempotent, removes by id from any position — a non-topmost instance can close
 *  (programmatically, or via unmount) without its marker having been popped first.
 *
 *  Does NOT reset `pendingProgrammaticBacks` here. An earlier version zeroed it
 *  whenever this call drained the stack to empty, meant to bound a desynced counter (a
 *  `history.back()` that produces no `popstate`, e.g. nothing earlier to go back to) to
 *  at most one swallowed back-press. That's unsound when two instances close in the
 *  same tick: the first's `releaseMarker` leaves the stack non-empty (no reset) and
 *  arms the counter; the second's `releaseMarker` then drains it to empty and zeroes
 *  the counter the first call just legitimately armed, while ITS OWN `history.back()`
 *  is still in flight — a real `popstate` then falls through to "topmost closes"
 *  instead of being swallowed, misattributing a self-triggered back-press to the user.
 *  Left un-self-correcting instead: a stuck-armed counter (the rare case this was
 *  guarding) swallows one future real back-press indefinitely rather than within one
 *  cycle, which is worse than never, but still strictly better than the alternative's
 *  wrong-overlay-closes failure mode. */
export function releaseMarker(id: string) {
  if (typeof window === "undefined") return;
  stack = stack.filter((entry) => entry.id !== id);
}

export function isMarkerRegistered(id: string): boolean {
  if (typeof window === "undefined") return false;
  return stack.some((entry) => entry.id === id);
}

/** Call immediately before every `history.back()` this module causes. */
export function notePendingProgrammaticBack() {
  if (typeof window === "undefined") return;
  pendingProgrammaticBacks += 1;
}

/** Test-only: this repo's vitest config shares the module registry across every test
 *  within a file (`isolate` resets per-file, not per-test), so a test that leaves stack
 *  entries or a nonzero counter behind would leak into later tests in the same file.
 *  Also detaches the real listener so a fresh one is attached for the next registration
 *  — otherwise a leftover listener from a prior test's `renderHook` would still be live
 *  and would double-handle the next test's `popstate` dispatch. */
export function resetBackToCloseStackForTests() {
  stack = [];
  pendingProgrammaticBacks = 0;
  if (typeof window !== "undefined" && listenerAttached) {
    window.removeEventListener("popstate", handlePopState);
  }
  listenerAttached = false;
}
