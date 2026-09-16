CREATE TABLE "backfill_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" text NOT NULL,
	"chunk_start" text NOT NULL,
	"chunk_end" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backfill_portfolio_instrument_chunk_idx" ON "backfill_jobs" USING btree ("portfolio_id","instrument_id","chunk_start");
