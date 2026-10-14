import { safeStorage } from "@/lib/safe-storage";

/**
 * PWA "open where you left off": the last visited in-app URL (path + search, locale prefix
 * stripped — next-intl's `usePathname` already does that) is kept in `localStorage`, and a
 * standalone launch of `/` navigates back to it. Only same-origin `(app)` routes are ever
 * stored or restored — never auth, onboarding or offline screens, never another origin.
 */
export const LAST_VISITED_KEY = "pocket:last-url";

/** Session-scoped guard: restore at most once per browser session, so an expired session
 *  (the app layout bounces back to `/`) can never loop. */
export const RESTORE_TRIED_KEY = "pocket:restore-tried";

/** Top-level `(app)` segments that may be restored. */
const RESTORABLE_SEGMENTS = new Set([
  "holdings",
  "transactions",
  "reports",
  "insights",
  "settings",
  "income",
  "tax",
  "savings",
  "trades",
  "instruments",
  "portfolios",
]);

/** Query params that hold a one-shot action rather than a view — never restored. */
const TRANSIENT_PARAMS = ["shared", "import", "entry", "harvestInstrument"];

/**
 * True when `target` is a root-relative `(app)` path (+ optional query/hash) that is safe
 * to navigate to. Rejects absolute / protocol-relative URLs, backslashes, control chars,
 * dot-segments and anything outside the `(app)` route allowlist.
 */
export function isRestorablePath(target: unknown): target is string {
  if (typeof target !== "string" || target.length === 0 || target.length > 2048) return false;
  if (!target.startsWith("/") || target.startsWith("//")) return false;
  if (/[\\\u0000-\u001f]/.test(target)) return false;
  let url: URL;
  try {
    url = new URL(target, "http://restore.invalid");
  } catch {
    return false;
  }
  if (url.origin !== "http://restore.invalid") return false;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.some((s) => s === "." || s === "..")) return false;
  if (!segments[0] || !RESTORABLE_SEGMENTS.has(segments[0])) return false;
  return !TRANSIENT_PARAMS.some((p) => url.searchParams.has(p));
}

/** Remember the current in-app URL. No-op for anything not restorable. */
export function recordLastVisited(
  pathname: string,
  search: string,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  const target = `${pathname}${search ? (search.startsWith("?") ? search : `?${search}`) : ""}`;
  if (!storage || !isRestorablePath(target)) return;
  try {
    storage.setItem(LAST_VISITED_KEY, target);
  } catch {
    // Storage full / blocked — restore is best-effort.
  }
}

/** The stored target if it still validates, else null. */
export function readLastVisited(storage: Pick<Storage, "getItem"> | null = safeStorage()) {
  if (!storage) return null;
  try {
    const value = storage.getItem(LAST_VISITED_KEY);
    return isRestorablePath(value) ? value : null;
  } catch {
    return null;
  }
}

/** Installed-PWA launch (Android/desktop `display-mode`, or iOS `navigator.standalone`). */
export function isStandaloneLaunch(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches)
  );
}
