CREATE TABLE "chat_provider_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"priority" integer,
	"model" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_provider_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chat_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pinned_provider" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_settings" ENABLE ROW LEVEL SECURITY;
