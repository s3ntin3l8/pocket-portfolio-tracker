"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * A single restartable `setTimeout` owned by a component, for transient UI state ("Copied!"
 * labels, a banner that fades after a few seconds, a blur-close delay).
 *
 * `schedule(fn, ms)` replaces any pending callback, so a second trigger gets its full delay
 * instead of being cut short by the first one's timer. `cancel()` drops the pending
 * callback. On unmount the pending callback is cleared and later `schedule` calls (e.g. from
 * an async continuation that resolves after navigation) are ignored, so it never updates a
 * component that is gone (or, in tests, fires after the DOM environment was torn down).
 *
 * The returned object and both members are referentially stable across renders.
 */
export function useTimeout(): {
  schedule: (fn: () => void, ms: number) => void;
  cancel: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const schedule = useCallback(
    (fn: () => void, ms: number) => {
      if (!mounted.current) return;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fn();
      }, ms);
    },
    [cancel],
  );

  // Set in the effect body too, so StrictMode's simulated unmount/remount re-arms it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  return useMemo(() => ({ schedule, cancel }), [schedule, cancel]);
}
