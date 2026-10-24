import { useTranslations } from "next-intl";
import { GAP_THRESHOLD } from "@portfolio/core";
import type { IbkrConnection, TrConnection } from "@portfolio/api-client";

type Reconciliation = NonNullable<TrConnection["lastReconciliation"]> &
  NonNullable<IbkrConnection["lastReconciliation"]>;

/**
 * Reported-vs-derived cash per currency after the last sync. Shared by the Trade Republic and
 * Interactive Brokers connected states (both namespaces carry the same `reconcile.*` keys).
 */
export function ReconcileSummary({
  recon,
  namespace,
}: {
  recon: Reconciliation | null | undefined;
  namespace: "TradeRepublic" | "InteractiveBrokers";
}) {
  const t = useTranslations(namespace);
  if (!recon) return null;
  return (
    <div className="space-y-1 rounded-md border px-3 py-2 text-sm">
      <p className="font-medium">{t("reconcile.title")}</p>
      {recon.cash.map((c) => {
        // The same tolerance the anomaly rules use — the two surfaces must not give
        // opposite signals for the same reconciliation.
        const off = Math.abs(Number(c.diff)) >= Number(GAP_THRESHOLD);
        return (
          <div key={c.currency} className="flex justify-between gap-2">
            <span className="text-muted-foreground">
              {t("reconcile.row", {
                currency: c.currency,
                // 2 dp: the stored derived figure carries Decimal's full precision.
                reported: Number(c.reported).toFixed(2),
                derived: Number(c.derived).toFixed(2),
              })}
            </span>
            <span className={off ? "text-destructive" : "text-muted-foreground"}>
              {off ? t("reconcile.off", { diff: c.diff }) : t("reconcile.match")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
