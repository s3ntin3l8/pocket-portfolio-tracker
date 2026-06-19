CREATE TABLE "import_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"strategy" text DEFAULT 'parser_first' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
