"use client";

import { useTranslations } from "next-intl";

/**
 * Received / Projected / Forecast key, rendered inline with the card title
 * (reference: single row, title left, legend right — not a separate row above
 * the chart).
 */
export function IncomeBarChartLegend() {
  const t = useTranslations("Income");
  return (
    <div className="ml-auto flex shrink-0 items-center gap-3.5 text-micro font-semibold text-text-2">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-xs bg-primary" />
        {t("tooltipReceived")}
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-xs bg-primary/25"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--color-primary) 0 1.5px, transparent 1.5px 4px)",
          }}
        />
        {t("tooltipProjected")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-xs border border-dashed border-primary bg-primary/10" />
        {t("tooltipForecast")}
      </span>
    </div>
  );
}
