"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Shared theme state for every theme control (header toggle, settings switcher, onboarding
 * pill). `mounted` flips true after hydration; until then `isDark` defaults to dark (the app's
 * default) so SSR and the first client render agree.
 */
export function useThemeMode() {
  const { theme, resolvedTheme, setTheme } = useTheme();
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
    toggle: () => setTheme(isDark ? "light" : "dark"),
  };
}
