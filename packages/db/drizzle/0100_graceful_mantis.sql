CREATE TABLE "ai_provider_settings" (
	"provider" text PRIMARY KEY NOT NULL,
	"allow_data_collection" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_task_settings" (
	"task" text PRIMARY KEY NOT NULL,
	"provider" text,
	"model" text,
	"effort" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_task_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Credentials are per provider, not per task: move the "vision:" namespace to "ai:".
-- The AES-GCM ciphertext carries no row id, so the value is valid under the new key as-is.
UPDATE "provider_credentials" SET "provider" = 'ai:' || substr("provider", 8) WHERE "provider" LIKE 'vision:%';
