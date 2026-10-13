"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/** `true` while the tab is in the foreground (`document.visibilityState !== "hidden"`).
 *  Server snapshot is `true` so SSR and the first client render agree. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

export interface UseIntervalOptions {
  /** Delay before the FIRST tick (defaults to `delayMs`). Later ticks use `delayMs`. */
  initialDelayMs?: number;
  /** Keep ticking while the tab is hidden. Default `false`: the timer is cleared on
   *  `visibilitychange` -> hidden and re-armed when the tab is shown again, so a
   *  backgrounded PWA doesn't poll the API (or burn battery) for nobody. */
  runWhenHidden?: boolean;
  /** Fire one tick immediately when the tab becomes visible again (instead of waiting a
   *  full `delayMs`). Default `false`. */
  tickOnResume?: boolean;
}

/**
 * `setInterval` that pauses while the page is hidden.
 *
 * - `delayMs === null` disables it (the idiom for "only while X is pending").
 * - Ticks are chained: the next one is scheduled only after the callback (and the promise
 *   it returns, if any) settles, so a slow request never overlaps the following tick.
 * - The latest `callback` is always the one invoked (no stale closures, and changing it
 *   does not restart the timer).
 * - The callback receives `isCancelled()`, true once the timer was stopped/disabled/
 *   unmounted — check it after an `await` before touching state.
 */
export function useInterval(
  callback: (ctx: { isCancelled: () => boolean }) => void | Promise<void>,
  delayMs: number | null,
  { initialDelayMs, runWhenHidden = false, tickOnResume = false }: UseIntervalOptions = {},
): void {
  const saved = useRef(callback);
  useEffect(() => {
    saved.current = callback;
  });

  useEffect(() => {
    if (delayMs === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstTick = true;
    let inFlight = false;

    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const hidden = () => !runWhenHidden && document.visibilityState === "hidden";

    const schedule = (wait: number) => {
      clear();
      if (cancelled || hidden()) return;
      timer = setTimeout(() => void tick(), wait);
    };

    const tick = async () => {
      timer = undefined;
      if (cancelled || hidden() || inFlight) return;
      inFlight = true;
      firstTick = false;
      try {
        await saved.current({ isCancelled: () => cancelled });
      } catch {
        // A throwing tick must not kill the poll loop.
      } finally {
        inFlight = false;
      }
      schedule(delayMs);
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        if (!runWhenHidden) clear();
        return;
      }
      if (inFlight || runWhenHidden) return; // the in-flight tick reschedules itself
      if (tickOnResume) void tick();
      else schedule(firstTick ? (initialDelayMs ?? delayMs) : delayMs);
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule(initialDelayMs ?? delayMs);
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [delayMs, initialDelayMs, runWhenHidden, tickOnResume]);
}
