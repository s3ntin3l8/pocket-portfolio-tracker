import { safeStorage } from "@/lib/safe-storage";

/**
 * Recently opened instruments for the command bar's "Recent" group. Only `{ id, symbol }`
 * is stored — both are global instrument data, never names, amounts, query strings or
 * anything about the user's holdings — newest first, capped at {@link RECENT_INSTRUMENTS_MAX}.
 */
export const RECENT_INSTRUMENTS_KEY = "pocket:recent-instruments";
export const RECENT_INSTRUMENTS_MAX = 6;

export interface RecentInstrument {
  id: string;
  symbol: string;
}

function isRecentInstrument(v: unknown): v is RecentInstrument {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "string" && r.id !== "" && typeof r.symbol === "string";
}

export function readRecentInstruments(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): RecentInstrument[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_INSTRUMENTS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(isRecentInstrument)
          // Re-project: drop any extra fields a tampered/older entry might carry.
          .map((r) => ({ id: r.id, symbol: r.symbol }))
          .slice(0, RECENT_INSTRUMENTS_MAX)
      : [];
  } catch {
    return [];
  }
}

/** Move the instrument to the front of the list (de-duplicated by id). */
export function recordRecentInstrument(
  instrument: RecentInstrument,
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): void {
  if (!storage || !instrument.id || !instrument.symbol) return;
  try {
    const entry = { id: instrument.id, symbol: instrument.symbol };
    const next = [entry, ...readRecentInstruments(storage).filter((r) => r.id !== entry.id)].slice(
      0,
      RECENT_INSTRUMENTS_MAX,
    );
    storage.setItem(RECENT_INSTRUMENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage full / blocked — recents are best-effort.
  }
}
