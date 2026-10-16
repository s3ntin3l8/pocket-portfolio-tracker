"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { forecastSeries } from "@portfolio/core";
import { Button } from "@/components/ui/button";
import { Card, CardLabel } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LazyForecastChart as ForecastChart } from "@/components/charts/lazy";
import { formatMoney, formatMoneyCompact, formatPercent } from "@/lib/utils";

/** Parse a numeric input, treating blank/invalid as 0 and clamping to a range. */
function num(v: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Interactive savings forecast. Recomputes a projected balance entirely in the
 * browser (pure core math) as the monthly amount, expected return and horizon
 * change — no network round-trip.
 *
 * A neutral card (same surface as Holdings' `HeroGlanceCard`) with muted lever rows, a
 * brand-green projection chart and a contributed/growth split footer.
 */
export function ForecastPanel({
  currentValue,
  netContributed = "0",
  monthlyAverage,
  seedAnnualReturn,
  currency,
  birthYear = null,
  portfolioType = "standard",
  retirementAge = null,
}: {
  currentValue: string;
  netContributed?: string;
  monthlyAverage: string;
  seedAnnualReturn: string;
  currency: string;
  birthYear?: number | null;
  portfolioType?: "standard" | "child";
  retirementAge?: number | null;
}) {
  const t = useTranslations("Savings");
  const locale = useLocale();
  const now = new Date().getFullYear();

  // Years from now until the target age (18 for children, retirementAge for adults),
  // clamped to the slider range. Null when there's no target age.
  const yearsToTarget =
    birthYear != null
      ? portfolioType === "child"
        ? Math.min(50, Math.max(1, 18 - (now - birthYear)))
        : retirementAge != null
          ? Math.min(50, Math.max(1, retirementAge - (now - birthYear)))
          : null
      : null;

  const [monthly, setMonthly] = useState(Math.round(Number(monthlyAverage)));
  const [returnPct, setReturnPct] = useState(Math.round(Number(seedAnnualReturn) * 1000) / 10);
  const [years, setYears] = useState(yearsToTarget ?? 10);

  const series = useMemo(
    () =>
      forecastSeries({
        presentValue: currentValue,
        monthlyContribution: String(monthly),
        annualReturnRate: String(returnPct / 100),
        horizonMonths: years * 12,
      }),
    [currentValue, monthly, returnPct, years],
  );

  // Three scenario chips at rate−3pp / current rate / rate+3pp (clamped to the
  // slider's 0–15 range, deduped at the extremes so e.g. rate=0 yields 2 chips,
  // not 3 with a duplicate). Each re-runs the same client-side projection at that
  // rate for the current monthly top-up + horizon.
  const scenarios = useMemo(() => {
    const rates = [
      ...new Set([
        Math.max(0, Math.round((returnPct - 3) * 2) / 2),
        returnPct,
        Math.min(15, Math.round((returnPct + 3) * 2) / 2),
      ]),
    ];
    return rates.map((rate) => {
      const scenarioSeries = forecastSeries({
        presentValue: currentValue,
        monthlyContribution: String(monthly),
        annualReturnRate: String(rate / 100),
        horizonMonths: years * 12,
      });
      return {
        rate,
        value: Number(scenarioSeries[scenarioSeries.length - 1].value),
        active: rate === returnPct,
      };
    });
  }, [currentValue, monthly, returnPct, years]);

  const last = series[series.length - 1];
  const contributed = Number(last.contributed);
  const value = Number(last.value);
  const totalContributed = Number(netContributed) + contributed;
  const totalGrowth = Math.max(0, value - totalContributed);
  const growthPct = value > 0 ? (totalGrowth / value) * 100 : 0;
  const m = (n: number) => formatMoney(n, currency, locale);
  // Scenario chips are only ~1/3 of the card wide — abbreviate 7-figure values.
  const mc = (n: number) => formatMoneyCompact(n, currency, locale);

  const returnLabel = `${formatPercent(returnPct / 100, locale)} p.a.`;

  return (
    <Card className="p-5">
      <p className="text-body font-semibold">{t("forecastTitle")}</p>
      <CardLabel className="mt-px">{t("forecastSubtitle")}</CardLabel>

      {/* Levers — stacked muted rows, not a grid. */}
      <div className="mt-4 space-y-2.5">
        {/* Monthly top-up: label left, numeric input right. */}
        <div className="flex items-center justify-between gap-2.5 rounded-md bg-muted px-3 py-2.5">
          <Label htmlFor="forecast-monthly" className="text-xs font-medium text-muted-foreground">
            {t("monthlyAmount")}
          </Label>
          <input
            id="forecast-monthly"
            type="number"
            min={0}
            inputMode="numeric"
            value={monthly}
            onChange={(e) => setMonthly(num(e.target.value, 0, 1_000_000))}
            className="tabular h-8 w-[134px] rounded-md border border-border bg-card px-2.5 text-right text-body-sm font-semibold text-foreground focus-visible:border-primary focus-visible:outline-none"
          />
        </div>

        {/* Expected return: label + bold value on one row, slider below. */}
        <div className="rounded-md bg-muted px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <Label htmlFor="forecast-return" className="text-xs font-medium text-muted-foreground">
              {t("annualReturn")}
            </Label>
            <span className="tabular text-body-sm font-semibold">{returnLabel}</span>
          </div>
          <input
            id="forecast-return"
            type="range"
            min={0}
            max={15}
            step={0.5}
            value={returnPct}
            onChange={(e) => setReturnPct(num(e.target.value, 0, 15))}
            className="h-[22px] w-full accent-primary"
          />
        </div>

        {/* Horizon: label (+ optional age-18 preset) + bold value, slider below. */}
        <div className="rounded-md bg-muted px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="forecast-years" className="text-xs font-medium text-muted-foreground">
                {t("horizonYears")}
              </Label>
              {yearsToTarget !== null && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-micro text-primary hover:bg-primary/10 hover:text-primary-strong"
                  onClick={() => setYears(yearsToTarget)}
                >
                  {portfolioType === "child" ? t("toAge18") : t("toRetirement")}
                </Button>
              )}
            </div>
            <span className="tabular text-body-sm font-semibold">
              {t("years", { count: years })}
            </span>
          </div>
          <input
            id="forecast-years"
            type="range"
            min={1}
            max={50}
            step={1}
            value={years}
            onChange={(e) => setYears(num(e.target.value, 1, 50))}
            className="h-[22px] w-full accent-primary"
          />
        </div>
      </div>

      {/* Hero projected figure + assumptions subtitle. */}
      <div className="mt-[18px]">
        <CardLabel>{t("projectedInYears", { count: years })}</CardLabel>
        <p
          className="tabular mt-0.5 text-hero font-bold leading-tight"
          data-testid="projected-value"
        >
          {m(value)}
        </p>
        <CardLabel className="mt-1">
          {t("forecastAssumptions", { amount: m(monthly), rate: returnLabel })}
        </CardLabel>
      </div>

      <div className="mt-3.5">
        <ForecastChart series={series} presentValue={currentValue} currency={currency} />
      </div>

      {/* Contributed / growth split — reference: thick track, translucent fill. */}
      <div className="mb-2 mt-3">
        <div className="flex h-2 overflow-hidden rounded-md bg-primary/30">
          <div className="h-full bg-primary" style={{ width: `${100 - growthPct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-micro font-medium text-muted-foreground">
          <span data-testid="projected-contributed">
            {t("projectedContributed")} {m(totalContributed)}
          </span>
          <span data-testid="projected-growth">
            {t("projectedGrowth")} {m(totalGrowth)}
          </span>
        </div>
      </div>

      <div
        className="mt-[18px] grid grid-cols-3 gap-2"
        role="group"
        aria-label={t("scenariosLabel")}
      >
        {scenarios.map((s) => (
          <div
            key={s.rate}
            data-testid="scenario-chip"
            data-active={s.active}
            className={
              s.active
                ? "rounded-md border border-primary bg-primary/10 px-3 py-2.5"
                : "rounded-md border border-transparent bg-muted px-3 py-2.5"
            }
          >
            <p className="text-micro font-medium text-muted-foreground">
              {formatPercent(s.rate / 100, locale)}
            </p>
            <p className="tabular mt-0.5 text-body font-bold">{mc(s.value)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
