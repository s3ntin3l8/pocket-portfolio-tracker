import { getTranslations } from "next-intl/server";
import { Info } from "lucide-react";
import type { AdminStats as AdminStatsData } from "@portfolio/api-client";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRows(rows: number | null | undefined): string {
  if (rows == null) return "—";
  return rows.toLocaleString();
}

/**
 * `/admin/database`. Design (`Admin Settings.dc.html`, "DATABASE / STATS" section): two
 * `rounded-[16px]` stat tiles (Database size / Rows est.), an uppercase "TABLES" eyebrow
 * over a `rounded-[20px]` table-list card, and — the design's one deviation from real
 * data — a static "Object storage not used" callout. This app's storage backend is
 * real and configurable (see PR B2's `admin-storage-form.tsx`), so that callout only
 * shows when storage genuinely isn't configured; when it is, the real usage stats render
 * in the same card style instead of the mock's hardcoded copy.
 */
export async function AdminStats({ stats }: { stats: AdminStatsData }) {
  const t = await getTranslations("Admin");
  const { db, objectStorage } = stats;
  // The real API has no top-level row-count total (only a per-table breakdown) — sum it
  // here for the design's "Rows (est.)" tile, but only when every table actually reported
  // a count; an empty/partial breakdown (PGlite, or a table whose count failed) should
  // read as "—", not silently undercount toward a misleadingly-precise-looking number.
  const rowsTotal =
    db.tables.length > 0 && db.tables.every((table) => table.rows !== null)
      ? db.tables.reduce((sum, table) => sum + table.rows!, 0)
      : null;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-1 rounded-[16px] bg-card p-[14px_15px] shadow-card">
          <div className="text-xs font-medium text-text-2">{t("statsDatabaseSize")}</div>
          <div className="mt-0.5 text-[22px] font-extrabold tabular-nums">
            {db.sizeBytes !== null ? formatBytes(db.sizeBytes) : t("statsSizeUnavailable")}
          </div>
        </div>
        <div className="flex-1 rounded-[16px] bg-card p-[14px_15px] shadow-card">
          <div className="text-xs font-medium text-text-2">{t("statsRowsEstimate")}</div>
          <div className="mt-0.5 text-[22px] font-extrabold tabular-nums">
            {formatRows(rowsTotal)}
          </div>
        </div>
      </div>

      <div className="px-0.5 text-xs font-bold uppercase tracking-[.04em] text-text-3">
        {t("statsTablesLabel")}
      </div>
      {db.tables.length > 0 ? (
        <div className="overflow-hidden rounded-[20px] bg-card shadow-card">
          <div className="hidden items-center gap-3 bg-background px-[15px] py-2.5 text-[11px] font-bold uppercase tracking-[.03em] text-text-3 md:flex">
            <span className="flex-1">{t("statsColumnTable")}</span>
            <span className="w-[100px] text-right">{t("statsRowsEstimate")}</span>
            <span className="w-[74px] text-right">{t("statsColumnSize")}</span>
          </div>
          {db.tables.map((table, i) => (
            <div
              key={table.name}
              className="flex items-center gap-3 px-[15px] py-[11px] max-md:justify-between"
              style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
            >
              <span className="font-mono text-[13px] font-semibold md:flex-1">{table.name}</span>
              <span className="tabular-nums text-xs text-text-2 md:w-[100px] md:text-right">
                {formatRows(table.rows)}
              </span>
              <span className="tabular-nums text-xs text-text-2 md:w-[74px] md:text-right">
                {formatBytes(table.sizeBytes)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs italic text-muted-foreground">
          {t("statsTableBreakdownUnavailable")}
        </p>
      )}

      {!objectStorage.configured ? (
        <div className="flex items-start gap-2.5 rounded-[14px] border border-border bg-background p-3.5">
          <Info className="mt-px size-[17px] shrink-0 text-text-3" strokeWidth={1.9} />
          <p className="text-xs leading-relaxed text-text-2">
            <span className="font-bold text-foreground">{t("statsObjectStorageNotUsedTitle")}</span>{" "}
            — {t("statsObjectStorageNotUsedBody")}
          </p>
        </div>
      ) : (
        <div className="rounded-[14px] border border-border bg-background p-3.5">
          <div className="text-xs font-bold text-foreground">{t("statsObjectStorage")}</div>
          {"error" in objectStorage && objectStorage.error ? (
            <p className="mt-1 text-xs text-destructive">{objectStorage.error}</p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {objectStorage.provider && (
                <>
                  <dt className="text-text-2">{t("statsProviderLabel")}</dt>
                  <dd className="font-mono tabular-nums">{objectStorage.provider}</dd>
                </>
              )}
              {objectStorage.objectCount !== undefined && (
                <>
                  <dt className="text-text-2">{t("storageObjectCount")}</dt>
                  <dd className="tabular-nums">{objectStorage.objectCount.toLocaleString()}</dd>
                </>
              )}
              {objectStorage.totalBytes !== undefined && (
                <>
                  <dt className="text-text-2">{t("storageTotalBytes")}</dt>
                  <dd className="tabular-nums">{formatBytes(objectStorage.totalBytes)}</dd>
                </>
              )}
              {objectStorage.freeBytes !== undefined && (
                <>
                  <dt className="text-text-2">{t("storageFreeBytes")}</dt>
                  <dd className="tabular-nums">{formatBytes(objectStorage.freeBytes)}</dd>
                </>
              )}
              {objectStorage.diskTotalBytes !== undefined && (
                <>
                  <dt className="text-text-2">{t("storageDiskTotal")}</dt>
                  <dd className="tabular-nums">{formatBytes(objectStorage.diskTotalBytes)}</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
