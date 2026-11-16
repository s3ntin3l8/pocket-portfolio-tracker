import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { accountHolders, portfolios, trConnections } from "@portfolio/db";
import { sessionExpiresAt } from "../../services/pytr/session-expiry.js";

type TrConnection = typeof trConnections.$inferSelect;

export function serialize(
  conn: TrConnection | null,
  pairingMethod: "push" | "authenticator" | null = null,
  sessionExpiresAt: Date | null = null,
) {
  return {
    status: conn?.status ?? "disconnected",
    portfolioId: conn?.portfolioId ?? null,
    lastSyncAt: conn?.lastSyncAt ?? null,
    lastError: conn?.lastError ?? null,
    lastReconciliation: conn?.lastReconciliation ?? null,
    syncing: conn?.syncing ?? false,
    // How the in-flight pairing signs in; null when none is pending.
    pairingMethod,
    // When the stored login stops working (derived from the session, never stored); null when
    // there is no session or its expiry can't be read. Trade Republic sessions last 24 h.
    sessionExpiresAt,
  };
}

export async function getConnection(
  app: FastifyInstance,
  userId: string,
): Promise<TrConnection | null> {
  const [conn] = await app.db
    .select()
    .from(trConnections)
    .where(eq(trConnections.userId, userId))
    .limit(1);
  return conn ?? null;
}

export async function lookupPortfolio(app: FastifyInstance, userId: string, portfolioId: string) {
  const [p] = await app.db
    .select({ id: portfolios.id, holderType: accountHolders.type })
    .from(portfolios)
    .leftJoin(accountHolders, eq(portfolios.accountHolderId, accountHolders.id))
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .limit(1);
  if (!p) return null;
  return { id: p.id, isChild: p.holderType === "child" };
}

/**
 * True for a row that was a real connection before the pairing now in flight: it had a session,
 * or it carries the error a failed sync/login left behind. A first setup has neither (the first
 * pairing clears both), so an abandoned one is not something to nag about.
 *
 * The same rule is expressed in three places that must change together: this function (used by
 * `POST /tr/connection/cancel`), the SQL in `reapAbandonedPairings`
 * (services/scheduler/cleanup.ts) and `abandoned` in the Holdings banner
 * (`tr-connection-banner.tsx`, which also accepts `lastSyncAt`).
 */
export function wasConnectedBefore(conn: Pick<TrConnection, "sessionEnc" | "lastError">): boolean {
  return conn.sessionEnc !== null || conn.lastError !== null;
}

/** The stored session's expiry, or null when none is stored, encryption is off or it can't be read. */
export function storedSessionExpiry(
  app: FastifyInstance,
  conn: Pick<TrConnection, "sessionEnc" | "status"> | null,
): Date | null {
  if (!conn?.sessionEnc || !app.encryption.isEnabled) return null;
  try {
    return sessionExpiresAt(app.encryption.decryptString(conn.sessionEnc));
  } catch {
    return null;
  }
}
