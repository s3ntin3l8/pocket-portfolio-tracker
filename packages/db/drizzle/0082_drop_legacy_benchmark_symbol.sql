-- Drop the legacy userPreferences.benchmark_symbol column now that every user
-- has been migrated to user_benchmark_symbols. The column is no longer read
-- by any code path: GET/PUT /me/preferences, /insights, and the BenchmarkCard
-- all consume user_benchmark_symbols exclusively.
ALTER TABLE "user_preferences" DROP COLUMN "benchmark_symbol";
