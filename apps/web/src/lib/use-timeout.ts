"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * A single restartable `setTimeout` owned by a component, for transient UI state ("Copied!"
 * labels, a banner that fades after a few seconds, a blur-close delay).
 *
 * `schedule(fn, ms)` replaces any pending callback, so a second trigger gets its full delay
 * instead of being cut short by the first one's timer. `cancel()` drops the pending
 * callback. The pending callback is cleared on unmount, so it never updates a component
 * that is gone (or, in tests, fires after the DOM environment was torn down).
 */
export function useTimeout(): {
  schedule: (fn: () => void, ms: number) => void;
  cancel: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const schedule = useCallback(
    (fn: () => void, ms: number) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fn();
      }, ms);
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel };
}
