-- Backfill user_benchmark_symbols from the legacy userPreferences.benchmark_symbol
-- column. Two passes:
--   1. Users with a non-null legacy symbol → lift it into the new table with
--      displayOrder = 0, displayName = the symbol (the API layer normalises
--      well-known symbols to friendly labels; for unknown symbols the bare ticker
--      is acceptable until the user edits the picker).
--   2. Users with NO benchmark set at all → seed ^GSPC (S&P 500) as the default,
--      matching the previous DEFAULT_BENCHMARK_SYMBOL.
--
-- The (user_id, symbol) unique index on user_benchmark_symbols already protects
-- against duplicate inserts from a user who somehow had both a legacy symbol and
-- a default-seed collision; the ON CONFLICT clause makes the migration
-- idempotent so a re-run on a partially-applied DB is safe.
INSERT INTO "user_benchmark_symbols" ("user_id", "symbol", "display_name", "display_order")
SELECT
	up."user_id",
	up."benchmark_symbol",
	up."benchmark_symbol",
	0
FROM "user_preferences" up
WHERE up."benchmark_symbol" IS NOT NULL
ON CONFLICT ("user_id", "symbol") DO NOTHING;
--> statement-breakpoint
-- Seed ^GSPC for any user with zero rows in user_benchmark_symbols after the
-- pass above. ON CONFLICT keeps this idempotent if the user already has the
-- symbol from the backfill.
INSERT INTO "user_benchmark_symbols" ("user_id", "symbol", "display_name", "display_order")
SELECT u."id", '^GSPC', 'S&P 500', 0
FROM "users" u
WHERE NOT EXISTS (
	SELECT 1 FROM "user_benchmark_symbols" ubs WHERE ubs."user_id" = u."id"
)
ON CONFLICT ("user_id", "symbol") DO NOTHING;
