-- One region vocabulary (#1025). Allocation used to key regions by code ("US", "EU", ...)
-- for markets and cash but by name ("North America", "Europe", ...) for ETF country
-- weights. Core now emits names only, so region targets saved against a code would never
-- match a slice again. Rewrite those keys to names, following the labels the web applied:
--   US, CA                     -> North America
--   EU                         -> Europe
--   ID, JP, SG, HK, AU         -> Asia
--   Commodity                  -> Other
-- The codes on the left are the ones MARKET_TO_REGION / CURRENCY_TO_REGION in
-- packages/core/src/allocation/maps.ts used to return; the names on the right are what
-- they return now.
--
-- Two codes can map to one name (US + CA), and a code can map to a name the scope already
-- holds, so a plain UPDATE would hit allocation_targets_scope_dim_key_idx. Instead, every
-- region target set (one user + one portfolio, NULL = networth level) that holds a code is
-- deleted and re-inserted grouped by the mapped key, summing target_pct. A set summed to
-- 100 before and still does. Sets with no code keys are not touched, so a re-run is a no-op.
WITH "region_map" ("code", "name") AS (
	VALUES
		('US', 'North America'),
		('CA', 'North America'),
		('EU', 'Europe'),
		('ID', 'Asia'),
		('JP', 'Asia'),
		('SG', 'Asia'),
		('HK', 'Asia'),
		('AU', 'Asia'),
		('Commodity', 'Other')
),
"scopes" AS (
	SELECT DISTINCT t."user_id", t."portfolio_id"
	FROM "allocation_targets" t
	JOIN "region_map" m ON m."code" = t."target_key"
	WHERE t."dimension" = 'region'
),
"removed" AS (
	DELETE FROM "allocation_targets" t
	USING "scopes" s
	WHERE t."dimension" = 'region'
		AND t."user_id" = s."user_id"
		AND t."portfolio_id" IS NOT DISTINCT FROM s."portfolio_id"
	RETURNING t."user_id", t."portfolio_id", t."target_key", t."target_pct", t."created_at"
)
INSERT INTO "allocation_targets" ("user_id", "portfolio_id", "dimension", "target_key", "target_pct", "created_at", "updated_at")
SELECT
	r."user_id",
	r."portfolio_id",
	'region',
	COALESCE(m."name", r."target_key"),
	SUM(r."target_pct"),
	MIN(r."created_at"),
	now()
FROM "removed" r
LEFT JOIN "region_map" m ON m."code" = r."target_key"
GROUP BY r."user_id", r."portfolio_id", COALESCE(m."name", r."target_key");
