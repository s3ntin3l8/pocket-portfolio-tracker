import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils";
import type { InsightsStreaks } from "@portfolio/api-client";

export function StreaksCard({ streaks, locale }: { streaks: InsightsStreaks; locale: string }) {
  const t = useTranslations("Insights.streaks");
  const winRate = streaks.totalMonths > 0 ? streaks.positiveMonths / streaks.totalMonths : 0;

  const bestLen = streaks.bestStreak?.length ?? null;
  const bestRet = streaks.bestStreak ? Number(streaks.bestStreak.totalReturnPct) : null;
  const worstLen = streaks.worstStreak?.length ?? null;
  const worstRet = streaks.worstStreak ? Number(streaks.worstStreak.totalReturnPct) : null;

  return (
    <Card className="rounded-2xl bg-card p-4 shadow-card">
      <p className="text-xs font-semibold text-text-2">{t("title")}</p>

      <div className="mt-3 space-y-3">
        {/* Best run */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-text-2">{t("bestRun")}</span>
            {bestLen !== null ? (
              <span className="tabular text-sm font-bold text-success">{bestLen}mo</span>
            ) : (
              <span className="text-sm text-text-3">—</span>
            )}
          </div>
          {streaks.bestStreak && (
            <p className="mt-0.5 text-[11px] text-text-3">
              {bestRet !== null && (
                <span className="font-semibold text-success">{formatPercent(bestRet, locale)}</span>
              )}
              <span className="ml-1.5">
                {streaks.bestStreak.start.slice(0, 7)} → {streaks.bestStreak.end.slice(0, 7)}
              </span>
            </p>
          )}
          {streaks.bestMonth && (
            <p className="mt-0.5 text-[11px] text-text-2">
              {t("bestMonth")}:{" "}
              <span className="font-semibold text-success">
                {formatPercent(Number(streaks.bestMonth.returnPct), locale)}
              </span>{" "}
              <span className="text-text-3">({streaks.bestMonth.date})</span>
            </p>
          )}
        </div>

        <div className="border-t border-border" />

        {/* Worst run */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-text-2">{t("worstRun")}</span>
            {worstLen !== null ? (
              <span className="tabular text-sm font-bold text-destructive">{worstLen}mo</span>
            ) : (
              <span className="text-sm text-text-3">—</span>
            )}
          </div>
          {streaks.worstStreak && (
            <p className="mt-0.5 text-[11px] text-text-3">
              {worstRet !== null && (
                <span className="font-semibold text-destructive">
                  {formatPercent(worstRet, locale)}
                </span>
              )}
              <span className="ml-1.5">
                {streaks.worstStreak.start.slice(0, 7)} → {streaks.worstStreak.end.slice(0, 7)}
              </span>
            </p>
          )}
          {streaks.worstMonth && (
            <p className="mt-0.5 text-[11px] text-text-2">
              {t("worstMonth")}:{" "}
              <span className="font-semibold text-destructive">
                {formatPercent(Number(streaks.worstMonth.returnPct), locale)}
              </span>{" "}
              <span className="text-text-3">({streaks.worstMonth.date})</span>
            </p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-text-2">
        {t("positiveMonths", {
          pct: Math.round(winRate * 100),
          pos: streaks.positiveMonths,
          total: streaks.totalMonths,
        })}
      </p>
    </Card>
  );
}
