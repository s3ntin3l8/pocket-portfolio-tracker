CREATE TABLE "scraped_quotes" (
	"key" text PRIMARY KEY NOT NULL,
	"value" numeric NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
