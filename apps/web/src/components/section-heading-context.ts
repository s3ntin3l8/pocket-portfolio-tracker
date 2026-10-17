"use client";

import { createContext, useContext } from "react";

/**
 * True while a `SettingsShell` is on its bare index route. There the shell owns the
 * page's single `<h1>` (its `title`), so a sub-page's `PageHeader` — which also renders
 * on desktop as the index's default section — demotes itself to an `<h2>`. On a sub-route
 * the shell renders no `<h1>` and `PageHeader` provides it.
 */
export const SectionHeadingContext = createContext(false);

export function useIsShellIndex(): boolean {
  return useContext(SectionHeadingContext);
}
