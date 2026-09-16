export {
  SYNC_CLAIM_LEASE_MS,
  JOB_DESCRIPTORS,
  QUEUE,
  SCHEDULE_CRON,
  SNAPSHOT_QUEUE,
  SNAPSHOT_CRON,
  INTRADAY_SNAPSHOT_QUEUE,
  INTRADAY_SNAPSHOT_CRON,
  TR_SYNC_QUEUE,
  TR_SYNC_CRON,
  IBKR_SYNC_QUEUE,
  ANTAM_QUEUE,
  ANTAM_CRON,
  NAV_QUEUE,
  NAV_CRON,
  DIVIDEND_QUEUE,
  DIVIDEND_CRON,
  INSTRUMENT_META_QUEUE,
  INSTRUMENT_META_CRON,
  GC_RECEIPTS_QUEUE,
  GC_RECEIPTS_CRON,
  RECOMPUTE_QUEUE,
  RECOMPUTE_SINGLETON_SECONDS,
  BACKFILL_STALE_QUEUE,
  BACKFILL_STALE_CRON,
  BACKFILL_PORTFOLIO_QUEUE,
  BACKFILL_INSTRUMENT_QUEUE,
  INSTRUMENT_META_SINGLETON_SECONDS,
} from "./scheduler/config.js";

export { resetStaleSyncFlags } from "./scheduler/cleanup.js";

export {
  activeBoss,
  getActiveBoss,
  setActiveBoss,
  triggerJob,
  enqueueIbkrSync,
  enqueueTrSync,
  enqueueRecompute,
  enqueueBackfillPortfolio,
  enqueueInstrumentMetadata,
  usesPglite,
} from "./scheduler/enqueue.js";

import { PgBoss } from "pg-boss";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { backfillJobs, ibkrConnections, trConnections } from "@portfolio/db";
import { getDb } from "../db/client.js";
import { getMarketData, flushUsage } from "./market-data.js";
import { refreshHeldPrices } from "./refresh.js";
import { refreshDividends } from "./dividends.js";
import { refreshInstrumentMetadata } from "./instrument-metadata.js";
import { recordDailySnapshots, recordIntradaySnapshots } from "./snapshots.js";
import { refreshAntamBuyback, refreshGaleri24Buyback, refreshNav } from "./scrapers/store.js";
import { syncTrConnection } from "./pytr/sync.js";
import { syncIbkrConnection } from "./ibkr/sync.js";
import {
  backfillPortfolioHistory,
  computeBackfillSnapshots,
  fetchInstrumentPrices,
  backfillStalePortfolios,
} from "./backfill.js";
import { gcStagedReceipts } from "../storage/receipts.js";
import { resetStaleSyncFlags } from "./scheduler/cleanup.js";
import { setActiveBoss, usesPglite, enqueueBackfillPortfolio } from "./scheduler/enqueue.js";
import {
  QUEUE,
  SCHEDULE_CRON,
  SNAPSHOT_QUEUE,
  SNAPSHOT_CRON,
  INTRADAY_SNAPSHOT_QUEUE,
  INTRADAY_SNAPSHOT_CRON,
  TR_SYNC_QUEUE,
  TR_SYNC_CRON,
  IBKR_SYNC_QUEUE,
  ANTAM_QUEUE,
  ANTAM_CRON,
  NAV_QUEUE,
  NAV_CRON,
  DIVIDEND_QUEUE,
  DIVIDEND_CRON,
  INSTRUMENT_META_QUEUE,
  INSTRUMENT_META_CRON,
  GC_RECEIPTS_QUEUE,
  GC_RECEIPTS_CRON,
  RECOMPUTE_QUEUE,
  RECOMPUTE_QUEUE_OPTIONS,
  BACKFILL_STALE_QUEUE,
  BACKFILL_STALE_CRON,
  BACKFILL_STALE_QUEUE_OPTIONS,
  BACKFILL_PORTFOLIO_QUEUE,
  BACKFILL_PORTFOLIO_QUEUE_OPTIONS,
  BACKFILL_INSTRUMENT_QUEUE,
  BACKFILL_INSTRUMENT_QUEUE_OPTIONS,
} from "./scheduler/config.js";

/**
 * Start the pg-boss scheduler that proactively warms the last-price cache on
 * market hours. No-op without an external Postgres (PGlite/tests), since pg-boss
 * needs real Postgres features. The refresh logic itself lives in refresh.ts and
 * is unit-tested independently.
 */
export async function startScheduler(app: FastifyInstance): Promise<void> {
  const url = app.config.DATABASE_URL;
  if (app.config.NODE_ENV === "test" || usesPglite(url)) {
    app.log.info("Price-refresh scheduler disabled (no external Postgres)");
    return;
  }

  // Cap pg-boss's own connection pool explicitly — left unset it falls back to `pg`'s
  // default of 10, which combined with the app's query pool (client.ts) can exhaust a
  // Supabase pooler's connection ceiling (see the EMAXCONNSESSION investigation).
  const boss = new PgBoss({ connectionString: url, max: 5 });
  setActiveBoss(boss);
  boss.on("error", (err) => app.log.error({ err }, "pg-boss error"));
  await boss.start();

  // See resetStaleSyncFlags: a killed/crashed worker leaves `syncing=true` with no lease
  // or reaper to clear it, wedging the connection (every retry 409s, cron sweep skips it
  // forever). Clear stale flags on every boot.
  const stale = await resetStaleSyncFlags(getDb());
  if (stale.trConnections > 0 || stale.ibkrConnections > 0) {
    app.log.warn(stale, "cleared stale syncing flags on startup");
  }

  await boss.createQueue(QUEUE);

  await boss.work(QUEUE, async () => {
    try {
      const refreshed = await refreshHeldPrices(getDb(), await getMarketData(), new Date());
      // Persist the provider calls this refresh made, so usage survives without an admin visit.
      await flushUsage();
      app.log.info({ refreshed }, "price refresh complete");
    } catch (err) {
      app.log.error({ err }, "price refresh failed");
    }
  });
  await boss.schedule(QUEUE, SCHEDULE_CRON);

  // Daily net-worth snapshots feed the dashboard's value-over-time chart.
  await boss.createQueue(SNAPSHOT_QUEUE);
  await boss.work(SNAPSHOT_QUEUE, async () => {
    try {
      const count = await recordDailySnapshots(
        getDb(),
        await getMarketData(),
        app.config.MARKET_DATA_TTL_MS,
        new Date(),
      );
      app.log.info({ count }, "daily snapshot complete");
    } catch (err) {
      app.log.error({ err }, "daily snapshot failed");
    }
  });
  await boss.schedule(SNAPSHOT_QUEUE, SNAPSHOT_CRON);

  // Intraday net-worth points feed the 1D/7D value-chart timeframes. Market-hours-gated
  // and prospective-only (see recordIntradaySnapshots for the retention/pruning story).
  await boss.createQueue(INTRADAY_SNAPSHOT_QUEUE);
  await boss.work(INTRADAY_SNAPSHOT_QUEUE, async () => {
    try {
      const count = await recordIntradaySnapshots(
        getDb(),
        await getMarketData(),
        app.config.MARKET_DATA_TTL_MS,
        new Date(),
      );
      app.log.info({ count }, "intraday snapshot complete");
    } catch (err) {
      app.log.error({ err }, "intraday snapshot failed");
    }
  });
  await boss.schedule(INTRADAY_SNAPSHOT_QUEUE, INTRADAY_SNAPSHOT_CRON);

  // Hourly Trade Republic sync + on-demand per-connection trigger.
  // When job data carries `connectionId`, only that connection is synced (the manual-sync
  // path triggered via POST /tr/connection/sync); otherwise all connected accounts are
  // synced (the cron path). `syncing` is cleared after each connection whether it
  // succeeded or failed, so the frontend poller always sees a terminal state.
  await boss.createQueue(TR_SYNC_QUEUE);
  await boss.work(TR_SYNC_QUEUE, async (jobs) => {
    const connectionId =
      Array.isArray(jobs) && jobs.length > 0
        ? (jobs[0]?.data as Record<string, unknown> | null)?.connectionId
        : undefined;
    const targetId = typeof connectionId === "string" ? connectionId : undefined;
    try {
      const conns = await getDb()
        .select()
        .from(trConnections)
        .where(
          targetId
            ? and(eq(trConnections.id, targetId), eq(trConnections.status, "connected"))
            : // Cron sweep: skip connections with a manual sync already in flight so the
              // hourly job can't race the collector read-modify-write against a user-
              // triggered sync. The targeted (manual) path is exempt — the route already
              // set `syncing` true for the very job we're now running.
              and(eq(trConnections.status, "connected"), eq(trConnections.syncing, false)),
        );
      for (const conn of conns) {
        const result = await syncTrConnection(
          getDb(),
          app.encryption,
          app.pytr,
          conn,
          app.log,
          app.storage,
        );
        if (result.status === "connected") {
          app.log.info({ connectionId: conn.id, result }, "tr sync complete");
        } else {
          app.log.warn({ connectionId: conn.id, result }, "tr sync non-connected");
        }
      }
    } catch (err) {
      // On unexpected failure, clear the syncing flag for the targeted connection so the
      // frontend doesn't spin forever. All-connections errors log but don't flip syncing.
      if (targetId) {
        try {
          await getDb()
            .update(trConnections)
            .set({ syncing: false, updatedAt: new Date() })
            .where(eq(trConnections.id, targetId));
        } catch {
          // best-effort
        }
      }
      app.log.error({ err }, "tr sync failed");
    }
  });
  await boss.schedule(TR_SYNC_QUEUE, TR_SYNC_CRON);

  // Daily IBKR Flex sync — EOD data so daily is sufficient; no hourly hammering.
  // `connectionId` in job data = sync that one connection only (manual trigger);
  // absent = sync all connected accounts (cron path).
  const ibkrSyncCron = app.config.IBKR_SYNC_CRON;
  await boss.createQueue(IBKR_SYNC_QUEUE);
  await boss.work(IBKR_SYNC_QUEUE, async (jobs) => {
    const connectionId =
      Array.isArray(jobs) && jobs.length > 0
        ? (jobs[0]?.data as Record<string, unknown> | null)?.connectionId
        : undefined;
    const targetId = typeof connectionId === "string" ? connectionId : undefined;
    try {
      const conns = await getDb()
        .select()
        .from(ibkrConnections)
        .where(
          targetId
            ? and(eq(ibkrConnections.id, targetId), eq(ibkrConnections.status, "connected"))
            : eq(ibkrConnections.status, "connected"),
        );
      for (const conn of conns) {
        const result = await syncIbkrConnection(
          getDb(),
          app.encryption,
          app.ibkrFlex,
          conn,
          app.log,
        );
        if (result.status === "connected") {
          app.log.info({ connectionId: conn.id, result }, "ibkr sync complete");
        } else {
          app.log.warn({ connectionId: conn.id, result }, "ibkr sync non-connected");
        }
      }
    } catch (err) {
      if (targetId) {
        try {
          await getDb()
            .update(ibkrConnections)
            .set({ syncing: false, updatedAt: new Date() })
            .where(eq(ibkrConnections.id, targetId));
        } catch {
          // best-effort
        }
      }
      app.log.error({ err }, "ibkr sync failed");
    }
  });
  await boss.schedule(IBKR_SYNC_QUEUE, ibkrSyncCron);

  // Scrape the gold buyback rates (Antam + Galeri24) into scraped_quotes; read in-process by
  // the default BuybackProviders (see market-data.ts). Each scraper self-handles failures
  // (returns null), so one dead source doesn't block the other.
  await boss.createQueue(ANTAM_QUEUE);
  await boss.work(ANTAM_QUEUE, async () => {
    try {
      const antam = await refreshAntamBuyback(getDb());
      const galeri24 = await refreshGaleri24Buyback(getDb());
      app.log.info({ antam, galeri24 }, "gold buyback scrape complete");
    } catch (err) {
      app.log.error({ err }, "gold buyback scrape failed");
    }
  });
  await boss.schedule(ANTAM_QUEUE, ANTAM_CRON);

  // Scrape the reksa-dana NAV catalogue (Bibit) into scraped_quotes; read in-process by the
  // default NavProvider (see market-data.ts).
  await boss.createQueue(NAV_QUEUE);
  await boss.work(NAV_QUEUE, async () => {
    try {
      const count = await refreshNav(getDb());
      app.log.info({ count }, "reksa-dana nav scrape complete");
    } catch (err) {
      app.log.error({ err }, "reksa-dana nav scrape failed");
    }
  });
  await boss.schedule(NAV_QUEUE, NAV_CRON);

  // Weekly dividend refresh: pull announced/historical dividend events from providers
  // and upsert into dividend_events, ready for the income page blend.
  await boss.createQueue(DIVIDEND_QUEUE);
  await boss.work(DIVIDEND_QUEUE, async () => {
    try {
      const count = await refreshDividends(getDb(), await getMarketData(), new Date());
      await flushUsage();
      app.log.info({ count }, "dividend refresh complete");
    } catch (err) {
      app.log.error({ err }, "dividend refresh failed");
    }
  });
  await boss.schedule(DIVIDEND_QUEUE, DIVIDEND_CRON);

  // Weekly instrument-metadata refresh: fetch sector/industry/country for held
  // instruments still missing a sector and write it onto the instrument row.
  // Accepts { force: true } payload (from admin panel "Force re-run") to re-enrich
  // all held instruments regardless of sectorCheckedAt.
  await boss.createQueue(INSTRUMENT_META_QUEUE);
  await boss.work(INSTRUMENT_META_QUEUE, async (jobs) => {
    const force =
      Array.isArray(jobs) && jobs.length > 0
        ? Boolean((jobs[0]?.data as Record<string, unknown> | null)?.force)
        : false;
    try {
      const count = await refreshInstrumentMetadata(getDb(), await getMarketData(), { force });
      await flushUsage();
      app.log.info({ count, force }, "instrument metadata refresh complete");
    } catch (err) {
      app.log.error({ err }, "instrument metadata refresh failed");
    }
  });
  await boss.schedule(INSTRUMENT_META_QUEUE, INSTRUMENT_META_CRON);

  // GC sweep: delete staged receipt documents from abandoned draft imports (#231).
  await boss.createQueue(GC_RECEIPTS_QUEUE);
  await boss.work(GC_RECEIPTS_QUEUE, async () => {
    try {
      const deleted = await gcStagedReceipts(app);
      app.log.info({ deleted }, "gc-staged-receipts complete");
    } catch (err) {
      app.log.error({ err }, "gc-staged-receipts failed");
    }
  });
  await boss.schedule(GC_RECEIPTS_QUEUE, GC_RECEIPTS_CRON);

  // Per-portfolio backfill work, fanned out from backfill-stale-history below. Each
  // portfolio gets its own pg-boss job (own expiry budget, independent retry, visible
  // pgboss.job row) instead of one global job whose handler timeout a force run at
  // platform scale blows through on the very first invocation. The per-portfolio
  // budget was raised from 900s to 2400s in #755 after a 26-instrument, ~5-year
  // portfolio was observed logging three orphan "complete" lines ~25–30 min apart
  // on a single trigger (see #755). See issues #745 and #755.
  await boss.createQueue(BACKFILL_PORTFOLIO_QUEUE, BACKFILL_PORTFOLIO_QUEUE_OPTIONS);
  await boss.updateQueue(BACKFILL_PORTFOLIO_QUEUE, BACKFILL_PORTFOLIO_QUEUE_OPTIONS);
  // batchSize pinned to 1 (pg-boss's own default, made explicit here): the loop below
  // re-throws per job so pg-boss records a genuine per-portfolio failure instead of a
  // false "completed" — that only marks the ONE failing job as failed rather than
  // cascading to every portfolio in the batch as long as batchSize stays 1. Bumping it
  // without also making the loop batch-safe (per-job try/catch that tracks failures
  // without re-throwing, or pg-boss's `perJobResults` API) would let one bad portfolio
  // re-fail its unrelated batch-mates on every retry.
  await boss.work(BACKFILL_PORTFOLIO_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      const { portfolioId, fromDate, tailOnly } = job.data as {
        portfolioId: string;
        fromDate?: string;
        tailOnly?: boolean;
      };
      // Heartbeat supervision is pg-boss's own (#763): BACKFILL_PORTFOLIO_QUEUE_OPTIONS
      // sets heartbeatSeconds, so `#processJobs` auto-touches this job every
      // heartbeatSeconds/2 while the handler promise is pending — no manual
      // setInterval/boss.touch() needed here. See BACKFILL_PORTFOLIO_QUEUE_OPTIONS'
      // doc comment in scheduler/config.ts for what heartbeat does and doesn't cover.
      try {
        // Planner path (#761): fan out per-instrument work, poll for completion
        const plannerResult = await backfillPortfolioHistory(
          getDb(),
          await getMarketData(),
          app.config.MARKET_DATA_TTL_MS,
          portfolioId,
          { fromDate, tailOnly, planner: true },
        );

        if ("pending" in plannerResult && (plannerResult as { pending: number }).pending > 0) {
          const pResult = plannerResult as {
            pending: number;
            subJobIds: string[];
            subJobs: Array<{
              backfillJobId: string;
              instrumentId: string;
              chunkStart: string;
              chunkEnd: string;
            }>;
          };
          const subJobIds = new Set(pResult.subJobIds);

          try {
            // The planner only inserted coordination rows (backfillPortfolioHistory);
            // it's this loop's job to actually enqueue the pg-boss jobs those rows
            // track. Without this, nothing ever consumes BACKFILL_INSTRUMENT_QUEUE and
            // the poll loop below waits forever on rows that will never turn "done".
            for (const sub of pResult.subJobs) {
              await boss.send(BACKFILL_INSTRUMENT_QUEUE, {
                backfillJobId: sub.backfillJobId,
                portfolioId,
                instrumentId: sub.instrumentId,
                chunkStart: sub.chunkStart,
                chunkEnd: sub.chunkEnd,
              });
            }

            app.log.info(
              { portfolioId, subJobs: pResult.pending },
              "backfill-portfolio: planner enqueued sub-jobs, polling for completion",
            );

            // Poll for sub-job completion
            let pending = pResult.pending;
            while (pending > 0) {
              await new Promise((resolve) => setTimeout(resolve, 5_000));

              const statusRows = await getDb()
                .select({ id: backfillJobs.id, status: backfillJobs.status })
                .from(backfillJobs)
                .where(inArray(backfillJobs.id, [...subJobIds] as string[]));
              const byStatus = new Map(statusRows.map((r) => [r.id, r.status]));
              const failedIds = [...subJobIds].filter((id) => byStatus.get(id) === "failed");
              if (failedIds.length > 0) {
                app.log.warn(
                  { portfolioId, failed: failedIds.length, failedIds },
                  "backfill-portfolio: sub-jobs failed, aborting planner",
                );
                throw new Error(`${failedIds.length}/${subJobIds.size} instrument sub-jobs failed`);
              }
              const doneCount = statusRows.filter((r) => r.status === "done").length;
              pending = subJobIds.size - doneCount;

              if (pending > 0) {
                app.log.debug(
                  { portfolioId, pending, done: doneCount },
                  "backfill-portfolio: still waiting for sub-jobs",
                );
              }
            }

            app.log.info(
              { portfolioId },
              "backfill-portfolio: all sub-jobs complete, computing snapshots",
            );
          } finally {
            // Clean up this run's coordination records — one row per instrument per
            // run, no economic state — whether the poll above succeeded or threw. Must
            // run on failure too: the unique (portfolioId, instrumentId, chunkStart)
            // index means a left-behind row from a failed attempt poisons every later
            // run of the same portfolio+instrument+chunk with a duplicate-key error on
            // insert. Scoped to this run's own row ids (not `eq(portfolioId, ...)`) so
            // a concurrently-running newer backfill of the same portfolio doesn't have
            // its own coordination rows deleted out from under its poll loop. Best-effort.
            try {
              await getDb()
                .delete(backfillJobs)
                .where(inArray(backfillJobs.id, [...subJobIds] as string[]));
            } catch {
              // best-effort
            }
          }
        }

        // Compute snapshots from the prices written by sub-jobs (or inline)
        const result = await computeBackfillSnapshots(getDb(), portfolioId, { fromDate });
        await flushUsage();
        app.log.info({ portfolioId, fromDate, tailOnly, ...result }, "backfill-portfolio complete");
      } catch (err) {
        app.log.error({ err, portfolioId, fromDate, tailOnly }, "backfill-portfolio failed");
        throw err; // let pg-boss record a genuine failure instead of a false "completed"
      }
    }
  });

  // Self-healing sweep: find portfolios whose snapshot history doesn't reach back to
  // inception (pre-existing portfolios that pre-date the backfill engine) and enqueue a
  // per-portfolio backfill onto BACKFILL_PORTFOLIO_QUEUE for each one that needs it.
  // Near-no-op once every portfolio is healed; continues to catch any portfolio that is
  // imported but never mutated. Now just a planner (two queries + N enqueues), so it
  // needs far less than the 900s default — see BACKFILL_STALE_QUEUE_OPTIONS.
  await boss.createQueue(BACKFILL_STALE_QUEUE, BACKFILL_STALE_QUEUE_OPTIONS);
  await boss.updateQueue(BACKFILL_STALE_QUEUE, BACKFILL_STALE_QUEUE_OPTIONS);
  await boss.work(BACKFILL_STALE_QUEUE, async (jobs) => {
    // Any job in a batched delivery carrying { force: true } (or { userId }) triggers a
    // full re-backfill — reading only jobs[0] silently dropped these flags on the rest
    // of a batch.
    const jobDatas = jobs.map((j) => j.data as Record<string, unknown> | null);
    const force = jobDatas.some((d) => Boolean(d?.force));
    const userId = jobDatas.find((d) => typeof d?.userId === "string")?.userId as
      string | undefined;
    try {
      const result = await backfillStalePortfolios(
        getDb(),
        await getMarketData(),
        app.config.MARKET_DATA_TTL_MS,
        {
          force,
          userId,
          enqueue: (portfolioId, fromDate, tailOnly) =>
            enqueueBackfillPortfolio(portfolioId, fromDate, tailOnly),
        },
      );
      if (result.enqueueFailed > 0) {
        app.log.warn(
          { scanned: result.scanned, queued: result.queued, enqueueFailed: result.enqueueFailed },
          "backfill-stale-history: some portfolios failed to enqueue",
        );
      }
      app.log.info(
        {
          scanned: result.scanned,
          queued: result.queued,
          enqueueFailed: result.enqueueFailed,
          force,
          userId,
        },
        "backfill-stale-history complete",
      );
    } catch (err) {
      app.log.error({ err, force, userId }, "backfill-stale-history failed");
      throw err; // let pg-boss record a genuine failure instead of a false "completed"
    }
  });
  await boss.schedule(BACKFILL_STALE_QUEUE, BACKFILL_STALE_CRON);

  // Per-instrument backfill sub-jobs (#761). Each job fetches prices for one
  // instrument within a date range and writes them to the `prices` table.
  // Enqueued by the backfill-portfolio planner; the planner polls for completion.
  await boss.createQueue(BACKFILL_INSTRUMENT_QUEUE, BACKFILL_INSTRUMENT_QUEUE_OPTIONS);
  await boss.updateQueue(BACKFILL_INSTRUMENT_QUEUE, BACKFILL_INSTRUMENT_QUEUE_OPTIONS);
  // includeMetadata: true surfaces retryCount/retryLimit on each job so the catch
  // block below can tell a transient failure (pg-boss will retry this same job) from
  // a terminal one — see the comment there.
  await boss.work(
    BACKFILL_INSTRUMENT_QUEUE,
    { batchSize: 1, includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) {
        const { backfillJobId, portfolioId, instrumentId, chunkStart, chunkEnd } = job.data as {
          backfillJobId: string;
          portfolioId: string;
          instrumentId: string;
          chunkStart: string;
          chunkEnd: string;
        };
        try {
          const result = await fetchInstrumentPrices(getDb(), await getMarketData(), {
            portfolioId,
            instrumentId,
            chunkStart,
            chunkEnd,
          });
          await flushUsage();

          // Mark coordination row as done
          await getDb()
            .update(backfillJobs)
            .set({ status: "done" })
            .where(eq(backfillJobs.id, backfillJobId));

          app.log.info(
            { backfillJobId, instrumentId, chunkStart, chunkEnd, days: result.days },
            "backfill-instrument complete",
          );
        } catch (err) {
          // pg-boss's own fetch query increments retryCount BEFORE this attempt runs
          // (0 on the first attempt), and retries this same job iff retryCount was
          // below retryLimit at the time it failed. So retryCount >= retryLimit here
          // means this WAS the last attempt pg-boss will make — only then is the
          // failure terminal. Marking the coordination row "failed" on every throw
          // (including ones pg-boss is about to retry) would make BACKFILL_INSTRUMENT_
          // QUEUE_OPTIONS.retryLimit dead config: the planner's poll loop aborts and
          // re-runs the WHOLE portfolio the moment it next polls (within 5s), well
          // before pg-boss's own retry of just this one instrument would have had a
          // chance to succeed.
          const { retryCount, retryLimit } = job;
          const isFinalAttempt = retryCount >= retryLimit;
          if (isFinalAttempt) {
            try {
              await getDb()
                .update(backfillJobs)
                .set({ status: "failed" })
                .where(eq(backfillJobs.id, backfillJobId));
            } catch {
              // best-effort
            }
          }
          app.log.error(
            { err, backfillJobId, instrumentId, chunkStart, chunkEnd, retryCount, retryLimit },
            "backfill-instrument failed",
          );
          throw err;
        }
      }
    },
  );

  // On-demand recompute after transaction mutations. Debounced per portfolio so bulk
  // imports collapse to one job; fromDate bounds the work to the affected window.
  // RECOMPUTE_QUEUE_OPTIONS sets heartbeatSeconds so pg-boss's own heartbeat
  // supervision (see BACKFILL_PORTFOLIO_QUEUE_OPTIONS' doc comment) applies here too.
  await boss.createQueue(RECOMPUTE_QUEUE, RECOMPUTE_QUEUE_OPTIONS);
  await boss.updateQueue(RECOMPUTE_QUEUE, RECOMPUTE_QUEUE_OPTIONS);
  await boss.work(RECOMPUTE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      try {
        const { portfolioId, fromDate } = job.data as { portfolioId: string; fromDate: string };
        const result = await backfillPortfolioHistory(
          getDb(),
          await getMarketData(),
          app.config.MARKET_DATA_TTL_MS,
          portfolioId,
          { fromDate },
        );
        app.log.info({ portfolioId, fromDate, ...result }, "history recompute complete");
      } catch (err) {
        app.log.error({ err }, "history recompute failed");
      }
    }
  });

  app.log.info(
    {
      priceCron: SCHEDULE_CRON,
      snapshotCron: SNAPSHOT_CRON,
      intradaySnapshotCron: INTRADAY_SNAPSHOT_CRON,
      trSyncCron: TR_SYNC_CRON,
      ibkrSyncCron,
      antamCron: ANTAM_CRON,
      navCron: NAV_CRON,
      dividendCron: DIVIDEND_CRON,
      recomputeQueue: RECOMPUTE_QUEUE,
      gcReceiptsCron: GC_RECEIPTS_CRON,
      backfillStaleCron: BACKFILL_STALE_CRON,
    },
    "Schedulers started",
  );

  app.addHook("onClose", async () => {
    await boss.stop();
    setActiveBoss(null);
  });
}
