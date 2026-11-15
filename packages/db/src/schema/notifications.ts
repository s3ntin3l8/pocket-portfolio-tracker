import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One Web Push subscription per browser/device a user enabled notifications on. The endpoint
 * is the push service URL and identifies the subscription (unique); the keys are the
 * subscriber's own public encryption material, stored encrypted at rest like other
 * connection secrets (`DB_ENCRYPTION_KEY`).
 */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dhEnc: text("p256dh_enc").notNull(),
  authEnc: text("auth_enc").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
}).enableRLS();
