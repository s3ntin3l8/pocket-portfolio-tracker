ALTER TABLE "instruments" ADD COLUMN "sector_weights" jsonb;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "sector_checked_at" timestamp with time zone;