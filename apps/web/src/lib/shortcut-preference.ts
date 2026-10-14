import { safeStorage } from "@/lib/safe-storage";

/**
 * Whether single-key shortcuts (`g` chords, `n`, `?`, `/`) are active. Stored client-side
 * only, default ON; the opt-out is for screen-reader and voice-control users, for whom a
 * bare letter key can fire by accident. Cmd/Ctrl-K is never affected.
 */
export const SHORTCUTS_DISABLED_KEY = "pocket:shortcuts-disabled";

export function readShortcutsEnabled(storage: Pick<Storage, "getItem"> | null = safeStorage()) {
  if (!storage) return true;
  try {
    return storage.getItem(SHORTCUTS_DISABLED_KEY) !== "1";
  } catch {
    return true;
  }
}

export function writeShortcutsEnabled(
  enabled: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    if (enabled) storage.removeItem(SHORTCUTS_DISABLED_KEY);
    else storage.setItem(SHORTCUTS_DISABLED_KEY, "1");
  } catch {
    // Storage blocked — the preference just won't persist.
  }
}
