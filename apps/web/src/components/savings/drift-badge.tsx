"use client";

import type { DriftRow } from "@portfolio/api-client";
import { useLocale, type useTranslations } from "next-intl";
import { tintStyle } from "@/lib/tint";
import { formatFixed, formatPercentPoints } from "@/lib/utils";

const DRIFT_BADGE_STYLE: Record<DriftRow["status"], { color: string; background: string }> = {
  on_target: tintStyle("primary"),
  over: tintStyle("destructive"),
  under: tintStyle("gold"),
};

export function DriftBadge({
  driftRow,
  t,
  td,
}: {
  driftRow: DriftRow;
  t: ReturnType<typeof useTranslations>;
  td: ReturnType<typeof useTranslations>;
}) {
  const locale = useLocale();
  const { driftPct, status } = driftRow;
  const absPct = formatFixed(Math.abs(driftPct), locale, 1);
  const label =
    status === "on_target" ? t("driftOnTarget") : formatPercentPoints(driftPct, locale, 1, "pp");
  return (
    <span
      className="shrink-0 rounded-xs px-1.5 py-0.5 text-micro font-bold"
      style={DRIFT_BADGE_STYLE[status]}
    >
      {label}
      {status !== "on_target" && (
        <span className="sr-only">
          {status === "over" ? td("over", { pct: absPct }) : td("under", { pct: absPct })}
        </span>
      )}
    </span>
  );
}
