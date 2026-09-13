ALTER TABLE "instruments" ADD COLUMN "price_feed_miss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "price_feed_last_miss_at" timestamp with time zone;
