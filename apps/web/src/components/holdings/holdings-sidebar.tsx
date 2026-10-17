import { getTranslations } from "next-intl/server";
import type { NetWorth } from "@portfolio/api-client";
import { AllocationCard } from "@/components/holdings/allocation-card";
import { PortfolioValueCard } from "@/components/holdings/portfolio-value-card";
import { RegionCurrencyCard } from "@/components/holdings/region-currency-card";
import { GainExplainer } from "@/components/gain-explainer";
import { toneOf } from "@/lib/tone";
import { formatNetWorth, formatPercent, formatSignedMoney } from "@/lib/utils";
import { PageRail } from "@/components/page-with-rail";

/**
 * Value stats + allocation donut + region/currency rail for Holdings. Allocation is the
 * aggregate/single-portfolio scope via loadNetWorth — the same cookie-driven scope the rest
 * of the app uses, independent of the `?portfolio=` override that only applies to the
 * positions table. Renders nothing when the payload carries no allocation.
 */
export async function HoldingsSidebar({ summary, locale }: { summary: NetWorth; locale: string }) {
  const allocation = summary.allocation;
  if (!allocation) return null;

  const [t, tc, tr] = await Promise.all([
    getTranslations("Holdings"),
    getTranslations("AssetClass"),
    getTranslations("Region"),
  ]);

  // Value of at-cost holdings per asset class (B7 made the slices sum correctly; G3 marks
  // which part of each slice is cost rather than a market price).
  const atCostByClass: Record<string, number> = {};
  for (const h of summary.holdings ?? []) {
    const cls = h.instrument?.assetClass;
    if (h.valuedAtCost && cls && h.marketValueDisplay != null) {
      atCostByClass[cls] = (atCostByClass[cls] ?? 0) + Number(h.marketValueDisplay);
    }
  }

  // Day-change %: the day's move over the prior close's book value. Securities that lack a
  // previous close contribute nothing to either totalDayChange or (via a null/0 market value)
  // totalMarketValue, so `market − change` is the priced book's opening base. Guard a
  // non-positive base.
  const dayBase = Number(summary.totalMarketValue) - Number(summary.totalDayChange);

  return (
    <PageRail className="space-y-3.5">
      <PortfolioValueCard
        totalLabel={t("allocation.totalLabel")}
        totalValueFormatted={formatNetWorth(summary.netWorth, summary.displayCurrency, locale)}
        allTimeLabel={t("allocation.allTimeLabel")}
        allTimeAmount={formatSignedMoney(
          Number(summary.totalUnrealizedPnL),
          summary.displayCurrency,
          locale,
        )}
        allTimePct={
          Number(summary.totalCost) > 0
            ? formatPercent(Number(summary.totalUnrealizedPnL) / Number(summary.totalCost), locale)
            : null
        }
        allTimeTone={toneOf(Number(summary.totalUnrealizedPnL))}
        allTimeExplainer={summary.gain ? <GainExplainer gain={summary.gain} /> : undefined}
        todayLabel={t("allocation.todayLabel")}
        todayAmount={formatSignedMoney(
          Number(summary.totalDayChange),
          summary.displayCurrency,
          locale,
        )}
        todayPct={
          dayBase > 0 ? formatPercent(Number(summary.totalDayChange) / dayBase, locale) : null
        }
        todayTone={toneOf(Number(summary.totalDayChange))}
      />

      {allocation.byAssetClass.some((s) => Number(s.value) > 0) && (
        <AllocationCard
          title={t("byAssetClass")}
          slices={allocation.byAssetClass
            .filter((s) => Number(s.value) > 0)
            .map((s) => ({
              key: s.key,
              label: s.key === "cash" ? tc("cash") : tc(s.key),
              value: Number(s.value),
              // Share of this class valued at cost (no market price) — hatched in the donut.
              atCostValue: atCostByClass[s.key],
              actualPct: s.pct,
            }))}
          atCostLegend={t("donutAtCostLegend")}
          currency={summary.displayCurrency}
          total={Number(summary.netWorth)}
        />
      )}

      <RegionCurrencyCard
        regionTitle={t("byRegion")}
        currencyTitle={t("byCurrency")}
        regionRows={allocation.byRegion
          .filter((s) => Number(s.value) > 0)
          .map((s) => ({ key: s.key, label: tr(s.key), pct: s.pct }))}
        currencyRows={allocation.byCurrency
          .filter((s) => Number(s.value) > 0)
          .map((s) => ({ key: s.key, label: s.key, pct: s.pct }))}
      />
    </PageRail>
  );
}
