"use client";

import { useTranslations } from "next-intl";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Anomaly } from "@portfolio/api-client";
import { cn, rowAnomalyCounts } from "@/lib/utils";

export function AnomalyBanner({
  anomalies,
  flaggedCount,
  showFlagged,
  onToggleFlagged,
}: {
  anomalies: Anomaly[];
  flaggedCount: number;
  showFlagged: boolean;
  onToggleFlagged: () => void;
}) {
  const ta = useTranslations("Anomalies");
  const { errors: anomalyErrorsCount, warnings: anomalyWarningsCount } =
    rowAnomalyCounts(anomalies);

  if (anomalyErrorsCount === 0 && anomalyWarningsCount === 0) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-sm",
        anomalyErrorsCount > 0
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-amber-400/40 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
      )}
    >
      {anomalyErrorsCount > 0 ? (
        <AlertCircle className="size-4 shrink-0" />
      ) : (
        <AlertTriangle className="size-4 shrink-0" />
      )}
      <span className="flex-1">
        {anomalyErrorsCount > 0 && anomalyWarningsCount > 0
          ? ta("bannerBoth", { errors: anomalyErrorsCount, warnings: anomalyWarningsCount })
          : anomalyErrorsCount > 0
            ? ta("bannerError", { count: anomalyErrorsCount })
            : ta("bannerWarning", { count: anomalyWarningsCount })}
      </span>
      {flaggedCount > 0 && (
        <Button
          type="button"
          size="sm"
          variant={showFlagged ? "secondary" : "outline"}
          aria-pressed={showFlagged}
          onClick={onToggleFlagged}
        >
          {ta("showFlagged")}
        </Button>
      )}
    </div>
  );
}
