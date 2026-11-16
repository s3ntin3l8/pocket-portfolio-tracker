import type { TrConnection } from "@portfolio/api-client";

/**
 * From this far before a Trade Republic login expires the Holdings banner offers an early
 * Renew. A login lasts 24 h and syncing does not extend it. Mirrors `RENEW_BANNER_WINDOW_MS` in
 * services/api/src/services/pytr/session-expiry.ts (the push notification fires later, at 3 h).
 */
export const RENEW_BANNER_WINDOW_MS = 6 * 60 * 60 * 1000;

export type TrBannerKind =
  { kind: "expired" | "error" | "abandoned" } | { kind: "expiring"; hoursLeft: number | null };

/** What (if anything) the Holdings banner should say about the Trade Republic connection. */
export function trBannerKind(connection: TrConnection | null, nowMs: number): TrBannerKind | null {
  if (!connection || !connection.portfolioId) return null;
  switch (connection.status) {
    case "expired":
    case "error":
      return { kind: connection.status };
    case "awaiting_2fa":
      // A renew the user walked away from leaves `awaiting_2fa` with no pairing behind it. The
      // server reaps that to `expired` within the hour; until then treat it as expired so the
      // prompt never disappears. A first setup (no sync and no error left behind) is not a renew.
      return connection.pairingMethod === null &&
        (connection.lastSyncAt !== null || connection.lastError !== null)
        ? { kind: "abandoned" }
        : null;
    case "connected": {
      if (!connection.sessionExpiresAt) return null;
      const msLeft = Date.parse(connection.sessionExpiresAt) - nowMs;
      if (Number.isNaN(msLeft) || msLeft > RENEW_BANNER_WINDOW_MS) return null;
      return { kind: "expiring", hoursLeft: msLeft <= 0 ? null : Math.ceil(msLeft / 3_600_000) };
    }
    default:
      return null;
  }
}
