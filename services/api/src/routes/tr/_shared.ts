import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { accountHolders, portfolios, trConnections } from "@portfolio/db";

type TrConnection = typeof trConnections.$inferSelect;

export function serialize(
  conn: TrConnection | null,
  pairingMethod: "push" | "authenticator" | null = null,
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
 * pairing clears both), so an abandoned one is not something to nag about. The one predicate
 * behind `POST /tr/connection/cancel`, `reapAbandonedPairings` and the Holdings banner.
 */
export function wasConnectedBefore(conn: Pick<TrConnection, "sessionEnc" | "lastError">): boolean {
  return conn.sessionEnc !== null || conn.lastError !== null;
}
