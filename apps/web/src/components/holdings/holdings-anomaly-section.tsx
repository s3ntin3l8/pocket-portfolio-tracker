import { getTranslations } from "next-intl/server";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { ScopeLink } from "@/components/scope-link";
import { ReconciliationBannerGroup } from "@/components/reconciliation-banner-group";
import { loadAnomalies, loadNetworthAnomalies } from "@/lib/server-api";
import {
  rowAnomalyCounts,
  bannerAnomalies,
  reconciliationItem,
  type AnomalyTranslator,
} from "@/lib/utils";

/**
 * Anomaly banners above the positions table. Streamed behind a `<Suspense>` — the anomaly
 * endpoint is independent of the holdings payload, so the table no longer waits on it.
 *
 * Headline count = ONLY anomalies that attach to a row (missing_transfer_basis, oversell,
 * negative_cash, …). Unlike Transactions, Holdings is a positions list — it has no
 * transaction rows and no "Show flagged only" filter, so a row-attached anomaly can never
 * be located ON this page; it links to Transactions instead, where it can. Anomalies with
 * nowhere to attach at all (reconciliation_gap, position_gap, …) are rendered as their own
 * labeled ReconciliationBanner — already fully locatable right here, no link needed (see
 * apps/web/src/lib/utils.ts `isRowAnomaly` for why this is a transactionId partition, not a
 * hardcoded code list).
 */
export async function HoldingsAnomalySection({
  portfolioParam,
  locale,
}: {
  portfolioParam?: string;
  locale: string;
}) {
  // The aggregate net-worth anomaly endpoint when no single portfolio is selected — matches
  // how Activity/Transactions loads anomalies for the all-portfolios view. Per-portfolio
  // anomalies only work with a specific ID.
  const [anomalies, ta] = await Promise.all([
    portfolioParam ? loadAnomalies(portfolioParam) : loadNetworthAnomalies(),
    getTranslations("Anomalies"),
  ]);

  const { errors: errorCount, warnings: warningCount } = rowAnomalyCounts(anomalies ?? []);
  const standaloneAnomalies = bannerAnomalies(anomalies ?? []);

  return (
    <>
      {(errorCount > 0 || warningCount > 0) && (
        <div
          role="alert"
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
            errorCount > 0
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-amber-400/40 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
          }`}
        >
          {errorCount > 0 ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          )}
          <span className="flex-1">
            {errorCount > 0 && warningCount > 0
              ? ta("bannerBoth", { errors: errorCount, warnings: warningCount })
              : errorCount > 0
                ? ta("bannerError", { count: errorCount })
                : ta("bannerWarning", { count: warningCount })}
          </span>
          <ScopeLink
            href="/transactions"
            className="shrink-0 font-medium underline underline-offset-2"
          >
            {ta("viewTransactions")}
          </ScopeLink>
        </div>
      )}
      <ReconciliationBannerGroup
        items={standaloneAnomalies.map((a) =>
          reconciliationItem(a, ta as AnomalyTranslator, locale, portfolioParam ?? undefined),
        )}
      />
    </>
  );
}
