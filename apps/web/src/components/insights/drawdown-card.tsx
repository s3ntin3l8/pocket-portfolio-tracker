import { signToneClass } from "@/lib/tone";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn, formatMoney, formatPercent } from "@/lib/utils";
import type { InsightsDrawdown } from "@portfolio/api-client";

/** The book counts as "small" at the high when it was worth under this share of today's value. */
const SMALL_PEAK_SHARE = 0.25;

export function DrawdownCard({
  drawdown,
  locale,
  currency,
}: {
  drawdown: InsightsDrawdown;
  locale: string;
  /** Display currency of the value figures; the size context is left out without it. */
  currency?: string;
}) {
  const t = useTranslations("Insights.drawdown");
  const maxDdpct = Number(drawdown.maxDrawdownPct);
  const currDdpct = Number(drawdown.currentDrawdownPct);
  const belowHigh = currDdpct < 0 && !!drawdown.currentPeakDate;

  // Context for a drawdown set while the book was tiny (e.g. a single early position): the index is
  // time-weighted, so −77% on €470 reads like −77% on a large book unless the size is shown. Each
  // high is dated and carries ITS OWN value: the deepest episode's peak, and — when the current
  // drawdown is measured from a different, later high — that one.
  const currentValue = Number(drawdown.currentValue ?? Number.NaN);
  const isSmall = (value: string | null | undefined) => {
    const v = Number(value ?? Number.NaN);
    return !!currency && v > 0 && currentValue > 0 && v < currentValue * SMALL_PEAK_SHARE;
  };
  const sizeNotes: { date: string; peak: number }[] = [];
  if (maxDdpct < 0 && drawdown.peakDate && isSmall(drawdown.peakValue)) {
    sizeNotes.push({ date: drawdown.peakDate, peak: Number(drawdown.peakValue) });
  }
  if (
    belowHigh &&
    drawdown.currentPeakDate &&
    drawdown.currentPeakDate !== drawdown.peakDate &&
    isSmall(drawdown.currentPeakValue)
  ) {
    sizeNotes.push({ date: drawdown.currentPeakDate, peak: Number(drawdown.currentPeakValue) });
  }

  return (
    <Card className="rounded-lg bg-card p-4 shadow-card">
      <p className="text-xs font-semibold text-text-2">{t("title")}</p>

      <div className="mt-0.5 flex items-baseline justify-between gap-3">
        <p
          className={cn(
            "tabular text-heading font-bold leading-none",
            maxDdpct < 0 ? "text-destructive" : "",
          )}
        >
          {formatPercent(maxDdpct, locale)}
        </p>
        <span className="text-xs text-text-2">
          {t("current")}:{" "}
          <span className={cn("font-semibold", signToneClass(currDdpct))}>
            {formatPercent(currDdpct, locale)}
          </span>
        </span>
      </div>

      <p className="mt-0.5 text-xs text-text-2">
        {drawdown.peakDate && drawdown.troughDate && (
          <span>
            {drawdown.peakDate} → {drawdown.troughDate}
          </span>
        )}
        {drawdown.recoveryDays !== undefined ? (
          <span className="text-text-2">
            {" · "}
            {t("recoveredIn", { days: drawdown.recoveryDays })}
          </span>
        ) : (
          maxDdpct < 0 && (
            <span className="text-text-2">
              {" · "}
              {t("notRecovered")}
            </span>
          )
        )}
      </p>

      {belowHigh && (
        <p className="mt-1 text-xs leading-5 text-text-2">
          {t("belowHigh", { date: drawdown.currentPeakDate ?? "" })}
        </p>
      )}

      {currency &&
        sizeNotes.map((n, i) => (
          <p key={n.date} className="mt-1 text-xs leading-5 text-text-2">
            {/* Today's value is stated once, on the first note. */}
            {i === 0
              ? t("smallPeak", {
                  date: n.date,
                  peak: formatMoney(n.peak, currency, locale),
                  current: formatMoney(currentValue, currency, locale),
                })
              : t("smallPeakShort", {
                  date: n.date,
                  peak: formatMoney(n.peak, currency, locale),
                })}
          </p>
        ))}
      {sizeNotes.length > 0 && (
        <p className="mt-1 text-xs leading-5 text-text-2">{t("smallPeakNote")}</p>
      )}
    </Card>
  );
}
