import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn, formatPercent } from "@/lib/utils";
import type { InsightsDrawdown } from "@portfolio/api-client";

export function DrawdownCard({ drawdown, locale }: { drawdown: InsightsDrawdown; locale: string }) {
  const t = useTranslations("Insights.drawdown");
  const maxDdpct = Number(drawdown.maxDrawdownPct);
  const currDdpct = Number(drawdown.currentDrawdownPct);
  const isUnderwater = currDdpct < 0;

  return (
    <Card className="rounded-2xl bg-card p-4 shadow-card">
      <p className="text-xs font-semibold text-text-2">{t("title")}</p>

      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <p
          className={cn(
            "tabular text-[22px] font-extrabold leading-none",
            maxDdpct < 0 ? "text-destructive" : "",
          )}
        >
          {formatPercent(maxDdpct, locale)}
        </p>
        <span className="text-xs text-text-2">
          {t("current")}:{" "}
          <span
            className={cn("font-semibold", currDdpct < 0 ? "text-destructive" : "text-success")}
          >
            {isUnderwater ? t("stillUnderwater") : formatPercent(currDdpct, locale)}
          </span>
        </span>
      </div>

      <p className="mt-0.5 text-xs text-text-2">
        {drawdown.peakDate && drawdown.troughDate && (
          <span>
            {drawdown.peakDate} → {drawdown.troughDate}
          </span>
        )}
        {drawdown.recoveryDays !== undefined && (
          <span className="text-text-3">
            {" · "}
            {t("recoveredIn", { days: drawdown.recoveryDays })}
          </span>
        )}
      </p>
    </Card>
  );
}
