export const QUEUE = "refresh-prices";
export const SCHEDULE_CRON = "*/5 * * * *";

export const SNAPSHOT_QUEUE = "daily-snapshot";
export const SNAPSHOT_CRON = "0 16 * * *";

export const INTRADAY_SNAPSHOT_QUEUE = "intraday-snapshot";
export const INTRADAY_SNAPSHOT_CRON = "*/15 * * * *";

export const TR_SYNC_QUEUE = "tr-sync";
export const TR_SYNC_CRON = "0 * * * *";

export const IBKR_SYNC_QUEUE = "ibkr-sync";

export const SYNC_CLAIM_LEASE_MS = 2 * 60 * 60_000; // 2 hours

export const ANTAM_QUEUE = "scrape-antam";
export const ANTAM_CRON = "0 */4 * * *";

export const NAV_QUEUE = "scrape-nav";
export const NAV_CRON = "0 1,16 * * *";

export const DIVIDEND_QUEUE = "refresh-dividends";
export const DIVIDEND_CRON = "0 6 * * 1";

export const INSTRUMENT_META_QUEUE = "refresh-instrument-metadata";
export const INSTRUMENT_META_CRON = "0 4 * * 0";

export const GC_RECEIPTS_QUEUE = "gc-staged-receipts";
export const GC_RECEIPTS_CRON = "0 3 * * *";

export const RECOMPUTE_QUEUE = "recompute-history";
export const RECOMPUTE_SINGLETON_SECONDS = 30;

export const BACKFILL_STALE_QUEUE = "backfill-stale-history";
export const BACKFILL_STALE_CRON = "0 5 * * *";
/**
 * The sweep itself is now just a planner (two queries + N enqueues onto
 * BACKFILL_PORTFOLIO_QUEUE below), so it needs far less than pg-boss's 900s default —
 * a short expiry lets a stuck sweep fail fast and retry instead of holding a "running"
 * job for 15 minutes. See issue #745.
 */
export const BACKFILL_STALE_QUEUE_OPTIONS = {
  expireInSeconds: 300,
  retryLimit: 1,
  retryDelay: 60,
  retryBackoff: true,
} as const;

/**
 * Per-portfolio backfill work, fanned out from backfill-stale-history (and reused by
 * on-demand recomputes that want a full historical re-backfill rather than a bounded
 * fromDate window). Each portfolio gets its own pg-boss job: its own expiry budget,
 * independent retry, and a `pgboss.job` row an operator can actually see progress on —
 * instead of one global job whose 900s handler timeout is exceeded by the very first
 * force run at platform scale. See issue #745.
 *
 * `expireInSeconds` was raised from 900 to 2400 in #755 after a 26-instrument, ~5-year
 * portfolio (~1881 days) was observed logging three "backfill-portfolio complete" lines
 * ~25–30 minutes apart on a single force trigger, with pg-boss marking the job
 * failed/retry *while the handler was still running* — the orphaned execution would
 * finish and log success while a concurrent retry kicked off a redundant second (and
 * third) run of the same portfolio. 2400s (40 min) leaves comfortable headroom over
 * the observed ~30 min upper bound; the previous raise to 1800s in the first iteration
 * of this PR was tight enough that any run exceeding 30 min by a second would have hit
 * the same orphaning bug.
 *
 * `retryLimit: 2` stays: the orphaning case is no longer the dominant cost (a real
 * run that completes within 2400s gets zero retries); only a handler that *throws*
 * still goes through the retry path, and that's the case retries are meant for. A
 * portfolio that *always* exceeds 2400s is genuinely oversized for this code path and
 * would benefit from per-instrument chunking (follow-up #761) or a handler heartbeat
 * (#762), not from more retries with the same broken supervision.
 */
export const BACKFILL_PORTFOLIO_QUEUE = "backfill-portfolio";
export const BACKFILL_PORTFOLIO_SINGLETON_SECONDS = 30;
export const BACKFILL_PORTFOLIO_QUEUE_OPTIONS = {
  expireInSeconds: 2400,
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
} as const;

export const INSTRUMENT_META_SINGLETON_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * The full descriptor for each scheduled queue, used by the admin jobs panel.
 * `cron: null` means the queue is triggered on-demand (no fixed schedule).
 *
 * #105 note: `triggerJob()` only affects the replica that receives the request.
 *  In a multi-replica setup the pg-boss job is still enqueued in Postgres so any
 *  idle worker replica can pick it up, but `invalidateMarketData()` /
 *  `invalidateScreenshotParser()` (in-process cache only) are NOT propagated.
 *  A LISTEN/NOTIFY fan-out is the proper fix; deferred until >1 replica is in use.
 */
export const JOB_DESCRIPTORS = [
  {
    name: QUEUE,
    label: "Price refresh",
    description: "Refresh last prices for all held instruments during market hours.",
    cron: SCHEDULE_CRON,
  },
  {
    name: SNAPSHOT_QUEUE,
    label: "Daily snapshot",
    description: "Record daily net-worth snapshots for the dashboard chart.",
    cron: SNAPSHOT_CRON,
  },
  {
    name: INTRADAY_SNAPSHOT_QUEUE,
    label: "Intraday snapshot",
    description:
      "Capture a net-worth point every 15 minutes (market-hours-gated) for the 1D/7D value chart.",
    cron: INTRADAY_SNAPSHOT_CRON,
  },
  {
    name: TR_SYNC_QUEUE,
    label: "Trade Republic sync",
    description: "Pull the latest Trade Republic timeline events and stage as draft imports.",
    cron: TR_SYNC_CRON,
  },
  {
    name: IBKR_SYNC_QUEUE,
    label: "Interactive Brokers sync",
    description: "Fetch IBKR Flex EOD statements and stage new transactions as draft imports.",
    cron: "0 2 * * *", // default; overridden by IBKR_SYNC_CRON env at runtime
  },
  {
    name: ANTAM_QUEUE,
    label: "Gold buyback scrape",
    description: "Scrape Antam and Galeri24 buyback rates into the scraped-quotes cache.",
    cron: ANTAM_CRON,
  },
  {
    name: NAV_QUEUE,
    label: "Reksa dana NAV scrape",
    description: "Scrape the Bibit NAV catalogue for all tracked mutual funds.",
    cron: NAV_CRON,
  },
  {
    name: DIVIDEND_QUEUE,
    label: "Dividend refresh",
    description: "Pull announced and historical dividend events from market-data providers.",
    cron: DIVIDEND_CRON,
  },
  {
    name: INSTRUMENT_META_QUEUE,
    label: "Instrument metadata refresh",
    description:
      "Fetch sector/industry/country from market-data providers for held instruments missing a sector.",
    cron: INSTRUMENT_META_CRON,
    supportsForce: true,
  },
  {
    name: GC_RECEIPTS_QUEUE,
    label: "Receipt GC",
    description:
      "Delete staged receipt documents from abandoned draft imports (older than 7 days).",
    cron: GC_RECEIPTS_CRON,
  },
  {
    name: BACKFILL_STALE_QUEUE,
    label: "Backfill stale history",
    description:
      "Find portfolios whose value-over-time history doesn't reach back to inception and backfill them. Idempotent — near-no-op once all portfolios are healed.",
    cron: BACKFILL_STALE_CRON,
    supportsForce: true,
  },
] as const;
