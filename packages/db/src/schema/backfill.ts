import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Internal coordination table for the backfill planner/sub-job pattern (#761).
 * Tracks per-instrument price-fetch sub-jobs so the planner knows when all
 * sub-jobs for a portfolio backfill are complete and it can proceed to the
 * snapshot-computation step.
 */
export const backfillJobs = pgTable(
  "backfill_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    portfolioId: uuid("portfolio_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    chunkStart: text("chunk_start").notNull(),
    chunkEnd: text("chunk_end").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    portfolioInstrumentChunk: uniqueIndex("backfill_portfolio_instrument_chunk_idx").on(
      t.portfolioId,
      t.instrumentId,
      t.chunkStart,
    ),
  }),
);
