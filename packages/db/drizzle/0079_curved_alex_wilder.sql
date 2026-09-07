ALTER TABLE "corporate_actions" ADD COLUMN "target_instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "ratio_to" numeric;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "taxable_market_value" numeric;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_target_instrument_id_instruments_id_fk" FOREIGN KEY ("target_instrument_id") REFERENCES "public"."instruments"("id") ON DELETE set null ON UPDATE no action;
