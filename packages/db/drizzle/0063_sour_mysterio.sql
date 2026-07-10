CREATE TYPE "public"."loss_pot" AS ENUM('stock', 'general');--> statement-breakpoint
CREATE TABLE "loss_carryforward" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"pot" "loss_pot" NOT NULL,
	"amount" numeric NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loss_carryforward" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loss_carryforward" ADD CONSTRAINT "loss_carryforward_holder_id_account_holders_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."account_holders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loss_carryforward_holder_year_pot_idx" ON "loss_carryforward" USING btree ("holder_id","tax_year","pot");--> statement-breakpoint
CREATE INDEX "loss_carryforward_holder_idx" ON "loss_carryforward" USING btree ("holder_id");