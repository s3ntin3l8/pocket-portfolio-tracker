-- Defense-in-depth: enable Row Level Security on every app table.
--
-- The PWA never connects to Postgres directly — all access goes through the Fastify
-- API, which connects as the privileged `postgres` role (BYPASSRLS) and scopes every
-- query to the authenticated user's `sub`. RLS with NO policies therefore does not
-- affect the app, but it closes Supabase's auto-generated Data API (PostgREST): with
-- RLS on and no policies, the anon/authenticated roles can read/write nothing. If we
-- ever expose the Data API intentionally, add per-table policies then.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instruments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "screenshot_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "last_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fx_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "corporate_actions" ENABLE ROW LEVEL SECURITY;
