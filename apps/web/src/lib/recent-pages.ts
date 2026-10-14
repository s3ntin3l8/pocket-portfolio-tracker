import { safeStorage } from "@/lib/safe-storage";

/**
 * Recently visited top-level pages for the command bar's "Recent" group. Only pathnames
 * (locale prefix already stripped) of pages in the command-page list are kept — no query
 * strings, no ids, nothing personal — newest first, capped at {@link RECENT_MAX}.
 */
export const RECENT_PAGES_KEY = "pocket:recent-pages";
export const RECENT_MAX = 6;

/** Normalise a pathname to its owning top-level segment (`/tax/2025` → `/tax`). */
export function topLevelPath(pathname: string): string {
  const first = pathname.split("/").filter(Boolean)[0];
  return first ? `/${first}` : "/";
}

export function readRecentPages(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_PAGES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Move `pathname`'s top-level page to the front of the list. Unknown pages are ignored. */
export function recordRecentPage(
  pathname: string,
  knownPaths: readonly string[],
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): void {
  const path = topLevelPath(pathname);
  if (!storage || !knownPaths.includes(path)) return;
  try {
    const next = [path, ...readRecentPages(storage).filter((p) => p !== path)].slice(0, RECENT_MAX);
    storage.setItem(RECENT_PAGES_KEY, JSON.stringify(next));
  } catch {
    // Storage full / blocked — recents are best-effort.
  }
}
