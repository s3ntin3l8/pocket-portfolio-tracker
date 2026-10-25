import { getTranslations } from "next-intl/server";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { ScopeLink } from "@/components/scope-link";
import { ReconciliationBannerGroup } from "@/components/reconciliation-banner-group";
import { loadScopeAnomalies, type Scope } from "@/lib/server-api";
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
export async function HoldingsAnomalySection({ scope, locale }: { scope: Scope; locale: string }) {
  // The anomalies of the page's scope — one portfolio, one holder's portfolios, or the
  // all-portfolios aggregate. The scope-aware entry point, so the banners here can never
  // show a different scope's anomalies than the rows underneath them.
  const [anomalies, ta] = await Promise.all([
    loadScopeAnomalies(scope),
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
              : "border-warning/40 bg-warning/10 text-warn-strong"
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
          reconciliationItem(
            a,
            ta as AnomalyTranslator,
            locale,
            scope.kind === "portfolio" ? scope.portfolioId : undefined,
          ),
        )}
      />
    </>
  );
}
