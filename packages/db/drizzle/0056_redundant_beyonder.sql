CREATE TABLE "portfolio_intraday_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"net_worth" numeric NOT NULL,
	"market_value" numeric DEFAULT '0' NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolio_intraday_snapshots" ADD CONSTRAINT "portfolio_intraday_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_intraday_snapshots_portfolio_captured_idx" ON "portfolio_intraday_snapshots" USING btree ("portfolio_id","captured_at");