"use client";

import type { DriftRow } from "@portfolio/api-client";
import type { useTranslations } from "next-intl";
import { tintStyle } from "@/lib/tint";

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
  const { driftPct, status } = driftRow;
  const absPct = Math.abs(driftPct).toFixed(1);
  const label =
    status === "on_target"
      ? t("driftOnTarget")
      : status === "over"
        ? `+${absPct}pp`
        : `−${absPct}pp`;
  return (
    <span
      className="shrink-0 rounded-xs px-1.5 py-0.5 text-micro font-extrabold"
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
