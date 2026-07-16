import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { adminAuditLog, importSettings } from "@portfolio/db";
import { importSettingsUpdateSchema } from "@portfolio/schema";
import { getImportStrategy, IMPORT_SETTINGS_ID } from "../services/import-settings.js";
import {
  refreshAntamBuyback,
  refreshGaleri24Buyback,
  refreshNav,
} from "../services/scrapers/store.js";
import { FolderProvider, S3Provider } from "../storage/index.js";
import { registerProvidersRoutes } from "./admin/providers.js";
import { registerVisionProvidersRoutes } from "./admin/vision-providers.js";
import { registerStorageRoutes } from "./admin/storage.js";
import { registerJobsRoutes } from "./admin/jobs.js";
import { registerUsersRoutes } from "./admin/users.js";

/**
 * Admin-only server configuration (requires the Authentik admin group via
 * `app.requireAdmin`). Today: market-data provider chain (enable/disable, fallback
 * priority, API keys), an audit log, and the scraper trigger.
 *
 * No secrets are ever returned — responses show `hasKey`/`keyHint` only.
 * Writing keys requires `app.encryption.isEnabled` (refuses with 503 when off).
 */
export async function adminRoute(app: FastifyInstance) {
  registerProvidersRoutes(app);
  registerVisionProvidersRoutes(app);
  registerStorageRoutes(app);
  registerJobsRoutes(app);
  registerUsersRoutes(app);

  // ─── Audit log ───────────────────────────────────────────────────────────

  // Recent admin actions (newest first, capped to 100 entries for the UI).
  app.get("/admin/audit", { preHandler: app.requireAdmin }, async () => {
    const rows = await app.db.select().from(adminAuditLog).orderBy(adminAuditLog.at).limit(100);
    return rows.reverse();
  });

  // ─── Scraper trigger ─────────────────────────────────────────────────────

  // Run the built-in scrapers now and cache the results, instead of waiting for the
  // scheduler's cron. Handy right after a deploy to populate scraped_quotes immediately.
  // Each scraper handles its own failures, so a dead source just yields null / 0 here.
  app.post("/admin/market-data/scrape", { preHandler: app.requireAdmin }, async () => {
    const antamBuyback = await refreshAntamBuyback(app.db);
    const galeri24Buyback = await refreshGaleri24Buyback(app.db);
    const navFunds = await refreshNav(app.db);
    return { antamBuyback, galeri24Buyback, navFunds };
  });

  // ─── DB statistics (#140) ────────────────────────────────────────────────

  /**
   * Database size, per-table row counts (estimated) and sizes, plus real storage
   * stats (object count, bytes, free space for folder provider).
   *
   * PGlite guard: `pg_database_size` / `pg_total_relation_size` / `pg_stat_user_tables`
   * are Postgres catalog functions not available under PGlite (used in tests).
   * Returns nulls when `NODE_ENV === "test"` so the route stays testable.
   */
  app.get(
    "/admin/stats",
    {
      // Explicit rate limit: admin-only but the handler does a filesystem walk (storage
      // stats), so tighten beyond the global default to prevent DoS via repeated calls.
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      preHandler: app.requireAdmin,
    },
    async () => {
      // The key user-data tables whose size we surface in the UI. Admin/config tables
      // (provider_settings, audit_log, etc.) are omitted — they stay small by design.
      const TABLES = [
        "users",
        "portfolios",
        "instruments",
        "transactions",
        "screenshot_imports",
        "prices",
        "last_prices",
        "fx_rates",
        "portfolio_snapshots",
        "dividend_events",
        "corporate_actions",
        "loans",
        "tr_connections",
        "tr_resolved_events",
      ] as const;

      let dbSizeBytes: number | null = null;
      let tableStats: { name: string; rows: number | null; sizeBytes: number | null }[] = [];

      if (process.env.NODE_ENV !== "test") {
        try {
          // DB total size
          const [{ size }] = await app.db.execute<{ size: string }>(
            sql`SELECT pg_database_size(current_database()) AS size`,
          );
          dbSizeBytes = Number(size);

          // Per-table: estimated live rows + total size (table + indexes + toast).
          // pg_stat_user_tables.n_live_tup is refreshed by autovacuum — exact after
          // VACUUM ANALYZE, otherwise a fast estimate. ANALYZE is scheduled nightly.
          const rows = await app.db.execute<{
            tablename: string;
            n_live_tup: string;
            total_bytes: string;
          }>(
            sql`SELECT
                t.tablename,
                COALESCE(s.n_live_tup, 0) AS n_live_tup,
                pg_total_relation_size(quote_ident(t.tablename)::regclass) AS total_bytes
              FROM pg_tables t
              LEFT JOIN pg_stat_user_tables s USING (tablename)
              WHERE t.schemaname = 'public'
                AND t.tablename IN ${TABLES}
              ORDER BY total_bytes DESC`,
          );

          tableStats = TABLES.map((name) => {
            const row = rows.find((r) => r.tablename === name);
            return {
              name,
              rows: row ? Number(row.n_live_tup) : 0,
              sizeBytes: row ? Number(row.total_bytes) : 0,
            };
          });
        } catch {
          // Catalog query failed (e.g. insufficient permissions or very early boot).
          // Return nulls rather than 500 — the UI will display "unavailable".
        }
      }

      // Storage stats — omitted under test (same PGlite guard rationale) but we still
      // return a shaped response so the UI always gets a consistent object.
      let objectStorage: {
        configured: boolean;
        provider?: string;
        objectCount?: number;
        totalBytes?: number;
        freeBytes?: number;
        diskTotalBytes?: number;
        error?: string;
      } = { configured: false };

      if (process.env.NODE_ENV !== "test") {
        try {
          // Resolve the underlying provider to determine its type for the UI label
          const { getStorageProvider: resolveProvider } = await import("../storage/index.js");
          const underlyingProvider = await resolveProvider(app);
          const isFolder = underlyingProvider instanceof FolderProvider;
          const providerLabel = isFolder
            ? "folder"
            : underlyingProvider instanceof S3Provider
              ? "s3"
              : "unknown";

          const stats = await underlyingProvider.stats?.();
          if (stats) {
            objectStorage = {
              configured: true,
              provider: providerLabel,
              objectCount: stats.objectCount,
              totalBytes: stats.totalBytes,
              ...(stats.freeBytes !== undefined ? { freeBytes: stats.freeBytes } : {}),
              ...(stats.diskTotalBytes !== undefined
                ? { diskTotalBytes: stats.diskTotalBytes }
                : {}),
            };
          } else {
            objectStorage = { configured: true, provider: providerLabel };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          objectStorage = { configured: true, error: message };
        }
      }

      return {
        db: {
          sizeBytes: dbSizeBytes,
          tables: tableStats,
        },
        objectStorage,
      };
    },
  );

  // ─── Import strategy (parser vs vision-LLM) ──────────────────────────────

  // The global first-choice for the unstructured import path. Defaults to
  // "parser_first" when no row exists. Does not affect CSV imports.
  app.get("/admin/import-settings", { preHandler: app.requireAdmin }, async () => ({
    strategy: await getImportStrategy(app.db),
  }));

  // Set the import strategy (singleton row id=1), then audit it.
  app.patch("/admin/import-settings", { preHandler: app.requireAdmin }, async (request) => {
    const { strategy } = importSettingsUpdateSchema.parse(request.body);
    await app.db
      .insert(importSettings)
      .values({ id: IMPORT_SETTINGS_ID, strategy })
      .onConflictDoUpdate({
        target: importSettings.id,
        set: { strategy, updatedAt: new Date() },
      });
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_import_settings",
      target: strategy,
      meta: { strategy },
    });
    return { strategy };
  });
}
