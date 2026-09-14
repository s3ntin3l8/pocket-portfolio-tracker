import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  jsonb,
  timestamp,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { assetClassEnum, unitEnum } from "./enums.js";

export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    isin: text("isin").unique(),
    wkn: text("wkn").unique(),
    symbol: text("symbol").notNull(),
    market: text("market").notNull(),
    exchangeCode: text("exchange_code"),
    assetClass: assetClassEnum("asset_class").notNull(),
    unit: unitEnum("unit").notNull().default("shares"),
    currency: text("currency").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    displayNameCheckedAt: timestamp("display_name_checked_at", { withTimezone: true }),
    sector: text("sector"),
    sectorWeights: jsonb("sector_weights").$type<Record<string, number>>(),
    sectorCheckedAt: timestamp("sector_checked_at", { withTimezone: true }),
    countryWeights: jsonb("country_weights").$type<Record<string, number>>(),
    countryCheckedAt: timestamp("country_checked_at", { withTimezone: true }),
    industry: text("industry"),
    country: text("country"),
    fundamentals: jsonb("fundamentals").$type<Record<string, unknown>>(),
    fundamentalsCheckedAt: timestamp("fundamentals_checked_at", { withTimezone: true }),
    faceValue: numeric("face_value"),
    couponRate: numeric("coupon_rate"),
    couponSchedule: text("coupon_schedule"),
    maturityDate: date("maturity_date"),
    partialExemptionRate: numeric("partial_exemption_rate"),
    /**
     * Consecutive backfill attempts that FAILED for this instrument — a "failure" is
     * either an empty candle array (provider resolved with nothing) OR a thrown error
     * (network failure, rate limit, auth failure — see issue #749). Both paths bump
     * this counter at the same rate, which is intentional: a feed alternating
     * throw/miss must reach DEAD_FEED_MISS_THRESHOLD as fast as one that's consistently
     * failing one way. Feeds the sweep's dead-feed backoff (see DEAD_FEED_MISS_THRESHOLD
     * in @portfolio/core) — issue #737.
     *
     * NOT incremented on XAU-spot fetch failures — those are shared across every
     * gold-only portfolio and the error is logged at warn level only. Gold-only
     * portfolios will therefore show `priceFeedMissCount` only climbing for non-XAU
     * instruments (or not at all if their only instruments are gold); grep logs for
     * `provider error fetching XAU spot history` if you suspect a dead gold feed.
     * Issue #749.
     */
    priceFeedMissCount: integer("price_feed_miss_count").notNull().default(0),
    priceFeedLastMissAt: timestamp("price_feed_last_miss_at", { withTimezone: true }),
    /**
     * Observability-only counter — tracks the subset of `priceFeedMissCount`
     * increments that were caused by provider THROWS (network error, rate limit,
     * auth failure, etc.) rather than by a provider that resolved with zero candles.
     * An error that looks like a miss is exactly how #749 happened: `.catch(() => [])`
     * collapsed both into the same `[]` path, so a feed that had been erroring for a
     * week got the same dead-feed cooldown treatment as a truly delisted one.
     *
     * Not used by the dead-feed cooldown (that decision reads `priceFeedMissCount`,
     * which counts both throws and empties at the same rate — see the docblock
     * above). The split is purely so an operator looking at a hot `priceFeedMissCount`
     * can tell at a glance whether the failures are "provider says no data" vs.
     * "provider is throwing 429s".
     *
     * Resets to 0 on any successful fetch (same lifetime rule as the miss counter).
     *
     * NOT incremented on XAU-spot fetch failures — see the `priceFeedMissCount`
     * docblock for why. Issue #749.
     */
    priceFeedErrorCount: integer("price_feed_error_count").notNull().default(0),
    priceFeedLastErrorAt: timestamp("price_feed_last_error_at", { withTimezone: true }),
    // User-maintained current price, absolute per-unit (same currency as the instrument),
    // for asset classes with no live market-data provider (e.g. Indonesian retail
    // bonds/sukuk — no schedulable secondary-market feed exists, see
    // docs/data_providers.md). Read in valuePortfolio() BEFORE the bond par fallback, so
    // it overrides par when set; never written by the provider cache (which would
    // clobber it on the next refresh — see services/api/src/services/price-cache.ts).
    manualPrice: numeric("manual_price"),
    manualPriceAt: timestamp("manual_price_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instruments_market_symbol_idx").on(t.market, t.symbol),
    index("instruments_symbol_trgm_idx").using("gin", t.symbol.op("gin_trgm_ops")),
    index("instruments_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
    index("instruments_isin_trgm_idx").using("gin", t.isin.op("gin_trgm_ops")),
    index("instruments_wkn_trgm_idx").using("gin", t.wkn.op("gin_trgm_ops")),
  ],
).enableRLS();
