import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  authSub: text("auth_sub").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  // Optional bcrypt-style scrypt hash ("salt:hash") for local password auth.
  // Null for OIDC-authenticated users; set by local registration or seed.
  passwordHash: text("password_hash"),
  // Admin flag for LOCAL auth only — OIDC users derive isAdmin per-request from the
  // Authentik group claim (plugins/auth.ts) and never read this column. Set true for
  // the first user created by POST /auth/local/setup; promotable afterwards via
  // PATCH /admin/users/:id.
  isAdmin: boolean("is_admin").notNull().default(false),
  // Set on every successful password change (change-password, admin set-password).
  // A local JWT whose `iat` predates this is rejected — "sign out everywhere" without a
  // session table, since the JWT itself is otherwise stateless for the full 7-day expiry.
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  displayCurrency: text("display_currency").notNull().default("IDR"),
  // Null until the onboarding flow finishes (or is explicitly skipped) — gates the
  // post-login redirect into /onboarding. Nullable-reset by an admin (reset-onboarding)
  // so the flow can be replayed for a given user.
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  scope: text("scope").notNull().default("read"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
