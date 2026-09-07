CREATE TABLE "user_benchmark_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"display_name" text NOT NULL,
	"display_order" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_benchmark_symbols" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_benchmark_symbols" ADD CONSTRAINT "user_benchmark_symbols_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_benchmark_symbols_user_symbol_idx" ON "user_benchmark_symbols" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "user_benchmark_symbols_user_order_idx" ON "user_benchmark_symbols" USING btree ("user_id","display_order");
-- DROP COLUMN "benchmark_symbol" is deferred to migration 0082, after the
-- backfill in 0081 has read every existing row.
