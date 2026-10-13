import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  uniqueIndex,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { portfolios } from "./portfolios.js";
import { transactions } from "./transactions.js";
import { instruments } from "./instruments.js";
import { corpActionTypeEnum } from "./enums.js";

export const dismissedAnomalies = pgTable(
  "dismissed_anomalies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    portfolioId: uuid("portfolio_id")
      .notNull()
      .references(() => portfolios.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dismissed_anomalies_pf_tx_code_idx").on(t.portfolioId, t.transactionId, t.code),
    index("dismissed_anomalies_portfolio_id_idx").on(t.portfolioId),
  ],
).enableRLS();

export const corporateActions = pgTable(
  "corporate_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    type: corpActionTypeEnum("type").notNull(),
    ratio: numeric("ratio").notNull(),
    exDate: date("ex_date").notNull(),
    // Merger valuation is portfolio-specific; null keeps legacy/global actions.
    portfolioId: uuid("portfolio_id").references(() => portfolios.id, { onDelete: "cascade" }),
    terms: text("terms"),
    // Merger-specific (nullable — only set when type = "merger")
    targetInstrumentId: uuid("target_instrument_id").references(() => instruments.id, {
      onDelete: "set null",
    }),
    ratioTo: numeric("ratio_to"),
    taxableMarketValue: numeric("taxable_market_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Every valuation queries by instrument (audit D7).
    index("corporate_actions_instrument_id_idx").on(t.instrumentId),
    // A duplicate split/bonus row would be double-applied by the holdings walk. portfolioId
    // is part of the key (NULLS NOT DISTINCT so two global rows still collide) because a
    // merger is recorded per portfolio — two portfolios may legitimately each hold a row
    // for the same instrument/type/exDate.
    unique("corporate_actions_instrument_type_exdate_pf_uq")
      .on(t.instrumentId, t.type, t.exDate, t.portfolioId)
      .nullsNotDistinct(),
  ],
).enableRLS();
