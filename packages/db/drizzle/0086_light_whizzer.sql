ALTER TABLE "instruments" ADD COLUMN "price_feed_error_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "price_feed_last_error_at" timestamp with time zone;
