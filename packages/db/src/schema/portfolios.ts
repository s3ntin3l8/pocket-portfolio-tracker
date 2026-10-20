import { pgTable, uuid, text, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { accountHolders } from "./account-holders.js";

export const portfolios = pgTable(
  "portfolios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseCurrency: text("base_currency").notNull().default("IDR"),
    accountHolderId: uuid("account_holder_id").references(() => accountHolders.id, {
      onDelete: "set null",
    }),
    brokerage: text("brokerage"),
    accountNumber: text("account_number"),
    iban: text("iban"),
    cashCounted: boolean("cash_counted").notNull().default(false),
    allowNegativeCash: boolean("allow_negative_cash").notNull().default(false),
    documentRetention: boolean("document_retention").notNull().default(false),
    taxAllowanceAnnual: numeric("tax_allowance_annual"),
    // Where the account is held (ISO 3166-1 alpha-2), or null when unset. The Indonesian
    // tax estimate reads it to classify cash interest as domestic or foreign.
    country: text("country"),
    /** Where crypto in this portfolio is sold: `domestic` (PAKD/PPMSE) or `foreign`.
     *  Null follows `country`: ID is domestic, anything else is not estimated. */
    cryptoTaxVenue: text("crypto_tax_venue"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("portfolios_user_id_idx").on(t.userId)],
).enableRLS();
