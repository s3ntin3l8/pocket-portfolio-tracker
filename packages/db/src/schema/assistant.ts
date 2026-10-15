import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Opt-in assistant conversation history (`user_preferences.assistant_save_history`). Text
 * only: the user's messages and the assistant's final answers — never tool inputs, tool
 * results or provider state, which can hold derived portfolio figures. Capped per user,
 * swept after a retention period, and deleted with the user.
 */
export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** What the user was viewing (`all`, `p:<id>`, `h:<id>`) when it started. */
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assistant_conversations_user_updated_idx").on(t.userId, t.updatedAt)],
).enableRLS();

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assistant_messages_conv_seq_idx").on(t.conversationId, t.seq)],
).enableRLS();
