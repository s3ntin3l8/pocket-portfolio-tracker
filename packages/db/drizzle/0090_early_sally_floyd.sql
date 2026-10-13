-- Dedupe first (audit D7): keep the earliest row of each (instrument, type, ex_date,
-- portfolio) group (created_at, then id as tie-break) so the unique constraint can apply.
DELETE FROM "corporate_actions" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (
      PARTITION BY "instrument_id", "type", "ex_date", "portfolio_id"
      ORDER BY "created_at", "id"
    ) AS rn FROM "corporate_actions"
  ) d WHERE d.rn > 1
);--> statement-breakpoint
CREATE INDEX "corporate_actions_instrument_id_idx" ON "corporate_actions" USING btree ("instrument_id");--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_instrument_type_exdate_pf_uq" UNIQUE NULLS NOT DISTINCT("instrument_id","type","ex_date","portfolio_id");
