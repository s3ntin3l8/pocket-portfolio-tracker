"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useTheme } from "next-themes";

/**
 * Switch theme as one uniform cross-fade (View Transitions API) instead of ~100 individually
 * transitioning elements racing each other while the rest snap. `ThemeProvider` sets
 * `disableTransitionOnChange`, so without the API (or under `prefers-reduced-motion`, which
 * the global view-transition rules also zero) this is the plain instant swap. `flushSync`
 * makes next-themes apply the class inside the transition callback, where the browser
 * captures the "after" frame.
 */
export function setThemeWithTransition(set: (theme: string) => void, next: string): void {
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (
    typeof document === "undefined" ||
    reduce ||
    typeof document.startViewTransition !== "function"
  ) {
    set(next);
    return;
  }
  document.startViewTransition(() => {
    flushSync(() => set(next));
  });
}

/**
 * Shared theme state for every theme control (header toggle, settings switcher, onboarding
 * toggle). `mounted` flips true after hydration; until then `isDark` defaults to dark (the app's
 * default) so SSR and the first client render agree.
 */
export function useThemeMode() {
  const { theme, resolvedTheme, setTheme: setThemeRaw } = useTheme();
  const setTheme = useCallback(
    (next: string) => setThemeWithTransition(setThemeRaw, next),
    [setThemeRaw],
  );
  const [mounted, setMounted] = useState(false);
  // One-time mount flag; the single setState on mount is intentional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;
  return {
    mounted,
    theme,
    isDark,
    setTheme,
    /**
     * Flips the *resolved* theme to an explicit light/dark. Deliberate asymmetry: a user on
     * "system" who hits a binary toggle (header button) is choosing a side, so
     * it leaves "system". The three-way ToggleGroup switcher is the way back to "system".
     */
    toggle: () => setTheme(isDark ? "light" : "dark"),
  };
}
