"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when the user asked the OS/browser for reduced motion. Server render and first
 * client paint assume `false` (animations allowed) — a reduced-motion user may see the
 * one-off initial paint animate before the store resyncs, so decorative loops should
 * also gate in CSS (`motion-reduce:` / the `globals.css` media block).
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(QUERY);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
