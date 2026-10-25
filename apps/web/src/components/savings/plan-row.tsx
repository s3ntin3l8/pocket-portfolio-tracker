"use client";

import type { DetectedPlan, DriftRow } from "@portfolio/api-client";
import type { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatPercentPoints } from "@/lib/utils";
import { monogram, softTintFor } from "@/lib/brokerages";
import { StepHint } from "./step-hint";
import { DriftBadge } from "./drift-badge";
import { cadenceLabel, nextExecution, shortDate } from "./sparplan-utils";

export function PlanRow({
  plan,
  driftRow,
  locale,
  t,
  td,
}: {
  plan: DetectedPlan;
  driftRow?: DriftRow;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  td: ReturnType<typeof useTranslations>;
}) {
  const label = plan.name ?? plan.symbol ?? plan.instrumentId;
  const tone = softTintFor(label);
  const amount = formatMoney(Number(plan.currentAmountDisplay), plan.currency, locale);

  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-xs font-bold"
        style={{ backgroundColor: tone.bg, color: tone.fg }}
        aria-hidden
      >
        {monogram(label)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-body-sm font-bold">{label}</span>
          <StepHint plan={plan} locale={locale} t={t} />
          {driftRow && <DriftBadge driftRow={driftRow} t={t} td={td} />}
          {plan.source === "heuristic" && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-micro font-semibold">
              {t("sourceHeuristic")}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-micro font-medium text-text-2">
          {cadenceLabel(plan.cadenceMonths, t)}
          {plan.status === "active" && (
            <>
              {" "}
              {" · "}
              {t("planNext", { date: shortDate(nextExecution(plan), locale) })}
            </>
          )}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="tabular text-body-sm font-bold">{amount}</p>
        {driftRow ? (
          <p className="tabular mt-0.5 text-micro font-semibold text-text-2">
            {t("nowPct", { pct: formatPercentPoints(driftRow.actualPct, locale, 0) })}
          </p>
        ) : (
          plan.status === "stopped" && (
            <p className="mt-0.5 text-micro font-semibold text-text-2">{t("statusStopped")}</p>
          )
        )}
      </div>
    </div>
  );
}
