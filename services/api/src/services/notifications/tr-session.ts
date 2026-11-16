import { eq } from "drizzle-orm";
import { trConnections } from "@portfolio/db";
import { notifyUser } from "./push.js";
import type { NotifyDeps } from "./push.js";
import { RENEW_NOTIFY_WINDOW_MS, sessionExpiresAt } from "../pytr/session-expiry.js";

type TrConnectionRow = typeof trConnections.$inferSelect;

const TAG = "tr-login";

/** Sent once when a sync finds the Trade Republic login has expired. */
export async function notifyTrLoginExpired(deps: NotifyDeps, userId: string): Promise<void> {
  await notifyUser(deps, userId, {
    title: "Trade Republic login expired",
    body: "Syncing is paused. Tap to renew it in the Trade Republic app.",
    url: "/holdings",
    tag: TAG,
  });
}

/**
 * Sent once per pairing when the stored login is within `RENEW_NOTIFY_WINDOW_MS` of expiring.
 * The expiry is derived from the stored session; the connection remembers the expiry it already
 * notified for, so the hourly sweep sends one push per login and a renew (a new expiry) re-arms
 * it. Not recorded when no device received it, so enabling notifications later still gets one.
 */
export async function notifyTrLoginExpiring(
  deps: NotifyDeps,
  conn: TrConnectionRow,
  now: Date = new Date(),
): Promise<boolean> {
  if (!conn.sessionEnc || !deps.encryption.isEnabled) return false;
  let expiresAt: Date | null;
  try {
    expiresAt = sessionExpiresAt(deps.encryption.decryptString(conn.sessionEnc));
  } catch {
    return false;
  }
  if (!expiresAt) return false;
  const msLeft = expiresAt.getTime() - now.getTime();
  if (msLeft <= 0 || msLeft > RENEW_NOTIFY_WINDOW_MS) return false;
  if (conn.expiryNotifiedFor?.getTime() === expiresAt.getTime()) return false;

  const hours = Math.max(1, Math.round(msLeft / 3_600_000));
  const { sent } = await notifyUser(deps, conn.userId, {
    title: "Trade Republic login expires soon",
    body: `Renew it within about ${hours} h (one tap, then confirm in the app) to keep syncing.`,
    url: "/holdings",
    tag: TAG,
  });
  if (sent === 0) return false;
  await deps.db
    .update(trConnections)
    .set({ expiryNotifiedFor: expiresAt })
    .where(eq(trConnections.id, conn.id));
  return true;
}

/**
 * `notifyTrLoginExpiring` for a connection by id, from a FRESH read. The sweep's own row predates
 * the sync it just ran, and a renew can finish meanwhile (the sync then keeps the new session),
 * so notifying from that row would warn about an expiry that no longer applies. A connection
 * deleted or no longer `connected` since is skipped.
 */
export async function notifyTrLoginExpiringById(
  deps: NotifyDeps,
  connectionId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [fresh] = await deps.db
    .select()
    .from(trConnections)
    .where(eq(trConnections.id, connectionId))
    .limit(1);
  if (!fresh || fresh.status !== "connected") return false;
  return notifyTrLoginExpiring(deps, fresh, now);
}
