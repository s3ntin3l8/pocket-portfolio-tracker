"use client";

import { useTranslations } from "next-intl";

/** Revenue / Earnings key, rendered inline with the section title (2 series → a legend
 *  is always present, per the app's chart conventions). */
export function RevenueEarningsChartLegend() {
  const t = useTranslations("Instrument");
  return (
    <div className="ml-auto flex shrink-0 items-center gap-3.5 text-micro font-semibold text-text-2">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-xs bg-[var(--color-chart-1)]" />
        {t("revenueLabel")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-xs bg-[var(--color-chart-2)]" />
        {t("earningsLabel")}
      </span>
    </div>
  );
}
