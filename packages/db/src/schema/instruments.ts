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
     * Consecutive backfill attempts that returned zero candles for this instrument.
     * Resets to 0 on any successful fetch. Feeds the sweep's dead-feed backoff (see
     * DEAD_FEED_MISS_THRESHOLD in @portfolio/core) — issue #737.
     */
    priceFeedMissCount: integer("price_feed_miss_count").notNull().default(0),
    priceFeedLastMissAt: timestamp("price_feed_last_miss_at", { withTimezone: true }),
    /**
     * Consecutive backfill fetch attempts that THREW (network error, rate limit,
     * auth failure) rather than resolving with zero candles — tracked separately from
     * `priceFeedMissCount` so a transient provider outage doesn't increment the miss
     * counter toward the dead-feed threshold. An error that looks like a miss is exactly
     * how #749 happened: `.catch(() => [])` collapsed both into the same `[]` path, so a
     * feed that had been erroring for a week got the same cooldown as a truly delisted
     * one. Resets to 0 on any successful fetch (same lifetime rule as the miss counter).
     *
     * NOT incremented on XAU-spot fetch failures — those are shared across every
     * gold-only portfolio and the error is logged at warn level only. Gold-only
     * portfolios will therefore show `priceFeedErrorCount = 0` even during an extended
     * XAU provider outage; grep logs for `provider error fetching XAU spot history` if
     * you suspect a dead gold feed. Issue #749.
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
