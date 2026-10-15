import { and, asc, count, desc, eq, lt, sql } from "drizzle-orm";
import { assistantConversations, assistantMessages, userPreferences } from "@portfolio/db";
import type { DB } from "../db/client.js";

/** Bounds on what an opted-in user keeps. */
export const MAX_CONVERSATIONS = 50;
export const MAX_CONVERSATION_MESSAGES = 200;
export const RETENTION_DAYS = 90;
const TITLE_CHARS = 80;

export async function isHistoryEnabled(db: DB, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: userPreferences.assistantSaveHistory })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.on === true;
}

const titleOf = (text: string) => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_CHARS ? `${oneLine.slice(0, TITLE_CHARS - 1)}…` : oneLine;
};

export interface SavedTurn {
  id: string;
  /** False when the conversation is full: the turn was not stored. */
  saved: boolean;
}

/**
 * Append one completed turn (the user's message and the assistant's final answer — text only)
 * to a conversation, creating it when `conversationId` is absent or not this user's. Creating a
 * conversation drops the user's oldest ones beyond the cap. Returns null (stores nothing) when
 * the user's opt-in is off at the moment of saving.
 */
export async function saveTurn(
  db: DB,
  userId: string,
  turn: { conversationId?: string; scope?: string; user: string; assistant: string },
): Promise<SavedTurn | null> {
  return db.transaction(async (tx) => {
    // Re-checked here, not just when the stream started: a turn can run for a long time, and a
    // user who turned history off meanwhile must not get this turn stored afterwards.
    const [pref] = await tx
      .select({ on: userPreferences.assistantSaveHistory })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    if (pref?.on !== true) return null;

    // An unknown or foreign id (deleted on another device, expired) starts a new conversation
    // rather than failing: the client learns the new id from the `conversation` event.
    let id: string | null = null;
    if (turn.conversationId) {
      const [own] = await tx
        .select({ id: assistantConversations.id })
        .from(assistantConversations)
        .where(
          and(
            eq(assistantConversations.id, turn.conversationId),
            eq(assistantConversations.userId, userId),
          ),
        )
        .limit(1)
        // Locks the conversation row for the rest of this transaction, so the message count we
        // read below is still the count we insert against (two tabs/devices racing). The unique
        // (conversation_id, seq) index is the backstop that makes a collision an error, not corruption.
        .for("update");
      id = own?.id ?? null;
    }
    if (!id) {
      const [created] = await tx
        .insert(assistantConversations)
        .values({ userId, title: titleOf(turn.user), scope: turn.scope ?? null })
        .returning({ id: assistantConversations.id });
      id = created!.id;
      // Keep the newest MAX_CONVERSATIONS (the one just created included).
      const stale = await tx
        .select({ id: assistantConversations.id })
        .from(assistantConversations)
        .where(eq(assistantConversations.userId, userId))
        .orderBy(desc(assistantConversations.updatedAt), desc(assistantConversations.createdAt))
        .offset(MAX_CONVERSATIONS);
      for (const s of stale) {
        await tx.delete(assistantConversations).where(eq(assistantConversations.id, s.id));
      }
    }

    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(assistantMessages)
      .where(eq(assistantMessages.conversationId, id));
    if (n + 2 > MAX_CONVERSATION_MESSAGES) return { id, saved: false };

    await tx.insert(assistantMessages).values([
      { conversationId: id, seq: n, role: "user", content: turn.user },
      { conversationId: id, seq: n + 1, role: "assistant", content: turn.assistant },
    ]);
    await tx
      .update(assistantConversations)
      .set({ updatedAt: new Date() })
      .where(eq(assistantConversations.id, id));
    return { id, saved: true };
  });
}

export function listConversations(db: DB, userId: string) {
  return db
    .select({
      id: assistantConversations.id,
      title: assistantConversations.title,
      scope: assistantConversations.scope,
      updatedAt: assistantConversations.updatedAt,
      // Table-qualified on purpose: a bare column reference inside the subquery would resolve to
      // the inner table's own `id`.
      messageCount: sql<number>`(select count(*)::int from assistant_messages m where m.conversation_id = "assistant_conversations"."id")`,
    })
    .from(assistantConversations)
    .where(eq(assistantConversations.userId, userId))
    .orderBy(desc(assistantConversations.updatedAt))
    .limit(MAX_CONVERSATIONS);
}

export async function getConversation(db: DB, userId: string, id: string) {
  const [conv] = await db
    .select({
      id: assistantConversations.id,
      title: assistantConversations.title,
      scope: assistantConversations.scope,
      updatedAt: assistantConversations.updatedAt,
    })
    .from(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, userId)))
    .limit(1);
  if (!conv) return null;
  const messages = await db
    .select({ role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages)
    .where(eq(assistantMessages.conversationId, id))
    .orderBy(asc(assistantMessages.seq));
  return { ...conv, messages };
}

export async function deleteConversation(db: DB, userId: string, id: string): Promise<boolean> {
  const gone = await db
    .delete(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, userId)))
    .returning({ id: assistantConversations.id });
  return gone.length > 0;
}

export async function deleteAllConversations(
  db: Pick<DB, "delete">,
  userId: string,
): Promise<number> {
  const gone = await db
    .delete(assistantConversations)
    .where(eq(assistantConversations.userId, userId))
    .returning({ id: assistantConversations.id });
  return gone.length;
}

/** Retention sweep (daily job): conversations untouched for {@link RETENTION_DAYS}. */
export async function purgeExpiredConversations(db: DB, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const gone = await db
    .delete(assistantConversations)
    .where(lt(assistantConversations.updatedAt, cutoff))
    .returning({ id: assistantConversations.id });
  return gone.length;
}
