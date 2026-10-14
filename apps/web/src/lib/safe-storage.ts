/**
 * `window.localStorage`, or `null` when unavailable (SSR, or storage blocked — private
 * mode, disabled cookies). Shared by the client-side "best-effort" stores (last visited,
 * recent pages/instruments, shortcut preference); each takes an injectable storage so
 * tests don't need the real thing.
 */
export function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
