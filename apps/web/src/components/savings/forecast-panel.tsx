"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { forecastSeries } from "@portfolio/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ForecastChart } from "@/components/charts/forecast-chart";
import { formatMoney, formatPercent } from "@/lib/utils";

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
 * Styled as the reference's green-gradient "hero" (same recipe as Holdings'
 * `HeroGlanceCard`: `linear-gradient(160deg,#0E9F6E,#0B7D58)`, `rounded-[26px]`,
 * `shadow-[0_12px_30px_rgba(14,159,110,.30)]`) — white-on-green controls, chart and
 * a contributed/growth split footer.
 */
export function ForecastPanel({
  currentValue,
  netContributed = "0",
  monthlyAverage,
  seedAnnualReturn,
  currency,
  birthYear = null,
  portfolioType = "standard",
}: {
  currentValue: string;
  netContributed?: string;
  monthlyAverage: string;
  seedAnnualReturn: string;
  currency: string;
  birthYear?: number | null;
  portfolioType?: "standard" | "child";
}) {
  const t = useTranslations("Savings");
  const locale = useLocale();

  // Years from now until the beneficiary turns 18 (clamped to the slider range).
  // Only child portfolios carry an age-18 target.
  const yearsToEighteen =
    portfolioType === "child" && birthYear
      ? Math.min(50, Math.max(1, 18 - (new Date().getFullYear() - birthYear)))
      : null;

  const [monthly, setMonthly] = useState(Math.round(Number(monthlyAverage)));
  const [returnPct, setReturnPct] = useState(
    Math.round(Number(seedAnnualReturn) * 1000) / 10,
  );
  const [years, setYears] = useState(yearsToEighteen ?? 10);

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
    const rates = [...new Set([
      Math.max(0, Math.round((returnPct - 3) * 2) / 2),
      returnPct,
      Math.min(15, Math.round((returnPct + 3) * 2) / 2),
    ])];
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

  return (
    <div
      className="rounded-[26px] p-5 pb-4 text-white shadow-[0_12px_30px_rgba(14,159,110,.30)] sm:rounded-[20px]"
      style={{ background: "linear-gradient(160deg,#0E9F6E,#0B7D58)" }}
    >
      <p className="text-[15px] font-bold">{t("forecastTitle")}</p>
      <p className="text-xs text-white/70">{t("forecastSubtitle")}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="forecast-monthly" className="text-xs font-semibold text-white/78">
            {t("monthlyAmount")}
          </Label>
          <input
            id="forecast-monthly"
            type="number"
            min={0}
            inputMode="numeric"
            value={monthly}
            onChange={(e) => setMonthly(num(e.target.value, 0, 1_000_000))}
            className="tabular w-full rounded-full border-none bg-white/15 px-3.5 py-1.5 text-right font-bold text-white placeholder:text-white/50 focus:bg-white/20 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="forecast-return" className="text-xs font-semibold text-white/78">
            {t("annualReturn")}: {formatPercent(returnPct / 100, locale)}
          </Label>
          <input
            id="forecast-return"
            type="range"
            min={0}
            max={15}
            step={0.5}
            value={returnPct}
            onChange={(e) => setReturnPct(num(e.target.value, 0, 15))}
            className="h-9 w-full accent-white"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="forecast-years" className="text-xs font-semibold text-white/78">
              {t("horizonYears")}: {t("years", { count: years })}
            </Label>
            {yearsToEighteen !== null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-white hover:bg-white/15 hover:text-white"
                onClick={() => setYears(yearsToEighteen)}
              >
                {t("toAge18")}
              </Button>
            )}
          </div>
          <input
            id="forecast-years"
            type="range"
            min={1}
            max={50}
            step={1}
            value={years}
            onChange={(e) => setYears(num(e.target.value, 1, 50))}
            className="h-9 w-full accent-white"
          />
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold text-white/70">
          {t("projectedInYears", { count: years })}
        </p>
        <p className="tabular mt-1 text-[34px] font-extrabold leading-tight" data-testid="projected-value">
          {m(value)}
        </p>
      </div>

      <div className="mt-4">
        <ForecastChart series={series} presentValue={currentValue} currency={currency} />
      </div>

      {/* Contributed / growth split — same visual language as the split bars on Reports. */}
      <div className="mt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-white" style={{ width: `${100 - growthPct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs font-semibold text-white/85">
          <span data-testid="projected-contributed">
            {t("projectedContributed")} {m(totalContributed)}
          </span>
          <span data-testid="projected-growth">
            {t("projectedGrowth")} {m(totalGrowth)}
          </span>
        </div>
      </div>

      <div
        className="mt-4 grid gap-2 sm:grid-cols-3"
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
                ? "rounded-xl bg-white p-3 text-[#0B7D58]"
                : "rounded-xl bg-white/12 p-3"
            }
          >
            <p
              className={`text-[10px] font-semibold ${s.active ? "text-[#0B7D58]/70" : "text-white/70"}`}
            >
              {formatPercent(s.rate / 100, locale)}
            </p>
            <p className="tabular mt-0.5 text-sm font-extrabold">{m(s.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
