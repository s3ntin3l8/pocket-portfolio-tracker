CREATE TYPE "public"."ibkr_connection_status" AS ENUM('disconnected', 'connected', 'expired', 'error');--> statement-breakpoint
CREATE TABLE "ibkr_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"portfolio_id" uuid,
	"token_enc" text NOT NULL,
	"query_id" text NOT NULL,
	"flex_account_id" text,
	"status" "ibkr_connection_status" DEFAULT 'disconnected' NOT NULL,
	"last_reconciliation" jsonb,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"syncing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ibkr_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "tr_resolved_events" ADD COLUMN "source" text DEFAULT 'pytr' NOT NULL;--> statement-breakpoint
ALTER TABLE "tr_resolved_events" DROP CONSTRAINT "tr_resolved_events_portfolio_id_event_id_pk";--> statement-breakpoint
ALTER TABLE "tr_resolved_events" ADD CONSTRAINT "tr_resolved_events_portfolio_id_source_event_id_pk" PRIMARY KEY("portfolio_id","source","event_id");--> statement-breakpoint
ALTER TABLE "ibkr_connections" ADD CONSTRAINT "ibkr_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ibkr_connections" ADD CONSTRAINT "ibkr_connections_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE set null ON UPDATE no action;