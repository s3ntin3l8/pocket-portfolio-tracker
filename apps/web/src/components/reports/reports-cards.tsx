import { deltaToneOf } from "@/lib/tone";
import { Coins, ScrollText, PiggyBank, Receipt, FileText, Gem } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ReportCard } from "@/components/reports/report-card";
import { GainFigure } from "@/components/gain-figure";
import { toneOf } from "@/lib/tone";
import type { TrendTone } from "@/components/reports/trend-chip";
import {
  incomeReport,
  tradesReport,
  contributionsReport,
  taxReport,
  taxRegimeOf,
  taxIdDetailReport,
  goldReport,
  taxDocumentsReport,
} from "@/components/reports/reports-data";
import {
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatQuantity,
  formatSignedMoney,
} from "@/lib/utils";

const ICONS = {
  income: Coins,
  trades: ScrollText,
  savings: PiggyBank,
  tax: Receipt,
  gold: Gem,
  documents: FileText,
} as const;

/*
 * One async server component per Reports card. Each awaits its own (request-cached) loader
 * from ./reports-data, so the page can stream every card behind its own <Suspense> instead
 * of holding the whole grid for the slowest endpoint. A card whose data is absent / failed
 * renders nothing — failures are surfaced once, by <ReportsStatus>.
 */

type CardProps = { locale: string };

export async function IncomeCard({ locale }: CardProps) {
  const [t, income] = await Promise.all([getTranslations("Reports"), incomeReport()]);
  const openLabel = t("open");
  if (income.status !== "ok") return null;

  const s = income.data;
  const currency = s.displayCurrency;
  const m = (n: number) => formatMoney(n, currency, locale);
  // The footer metrics sit three-up beside the "Open ›" link — the narrowest cells on
  // the card — so they get the compact form; the full-width headline above keeps
  // full precision.
  const mc = (n: number) => formatMoneyCompact(n, currency, locale);
  // Full-year outlook (actuals-to-date + rest-of-year forecast) vs last year, not just
  // actuals-to-date vs last year — matches the /income page's own headline delta. The
  // headline here is actuals-to-date, so the chip's label says it compares the estimate.
  const lastYearTotal = Number(s.lastYear);
  const fullYearDeltaAbs = Number(s.forecastFullYear) - lastYearTotal;
  const deltaPct = lastYearTotal > 0 ? fullYearDeltaAbs / lastYearTotal : null;
  const deltaTone: TrendTone = deltaToneOf(deltaPct);

  // Realized-to-date vs. forecasted-remainder, same green as the card icon — the
  // forecast segment is drawn as a diagonal-stripe hatch, matching the "Projected"
  // segment styling on the Income page's own per-year bar chart.
  // Tooltip labels are translated via the `Reports.income.tooltip*` keys
  // (added in the #478 review follow-up). Previously English literals were
  // passed inline with a TODO; the keys live alongside the rest of the
  // Reports-income strings for consistency.
  const thisYearAmt = Number(s.thisYear);
  const forecastFullYearAmt = Number(s.forecastFullYear);
  const remainingAmt = Math.max(0, forecastFullYearAmt - thisYearAmt);
  const splitBar =
    forecastFullYearAmt > 0
      ? [
          {
            pct: (thisYearAmt / forecastFullYearAmt) * 100,
            color: "var(--color-primary)",
            label: t("income.tooltipReceived"),
            amount: m(thisYearAmt),
          },
          {
            pct: (remainingAmt / forecastFullYearAmt) * 100,
            color: "var(--color-primary)",
            striped: true,
            label: t("income.tooltipForecast"),
            amount: m(remainingAmt),
          },
        ]
      : undefined;

  return (
    <ReportCard
      icon={ICONS.income}
      title={t("income.title")}
      trend={
        deltaPct !== null
          ? {
              label: t("income.trendVsLastYear", { pct: formatPercent(deltaPct, locale) }),
              tone: deltaTone,
              arrow: true,
            }
          : undefined
      }
      value={m(Number(s.thisYear))}
      valueCompact={mc(Number(s.thisYear))}
      caption={t("income.caption")}
      splitBar={splitBar}
      metrics={[
        { label: t("income.captionEstimated"), value: mc(Number(s.forecastFullYear)) },
        { label: t("income.metricTtm"), value: mc(Number(s.ttm)) },
        { label: t("income.metricLifetime"), value: mc(Number(s.lifetimeTotal)) },
      ]}
      href="/income"
      openLabel={openLabel}
    />
  );
}

export async function TradesCard({ locale }: CardProps) {
  const [t, trades] = await Promise.all([getTranslations("Reports"), tradesReport()]);
  const openLabel = t("open");
  if (!(trades.status === "ok" && trades.data.trades.length > 0)) return null;

  const log = trades.data;
  const currency = log.displayCurrency;
  const m = (n: number) => formatMoney(n, currency, locale);
  const mc = (n: number) => formatMoneyCompact(n, currency, locale);
  const currentYear = new Date().getUTCFullYear();
  const ytdEntry = log.realizedByYear.find((y) => y.year === currentYear);
  // No entry for the current year means no trades closed this year — 0, not the
  // all-time total (a prior fallback here conflated the two whenever `realizedByYear`
  // had no current-year row, e.g. every closed trade was from an earlier year).
  const ytdRealized = ytdEntry ? Number(ytdEntry.amount) : 0;

  const closedTrades = log.trades.filter((tr) => tr.status === "closed");
  const winSum = closedTrades
    .filter((tr) => Number(tr.totalReturn) > 0)
    .reduce((sum, tr) => sum + Number(tr.totalReturn), 0);
  const lossSum = closedTrades
    .filter((tr) => Number(tr.totalReturn) < 0)
    .reduce((sum, tr) => sum + Math.abs(Number(tr.totalReturn)), 0);
  const totalAbs = winSum + lossSum;
  const splitBar =
    totalAbs > 0
      ? [
          {
            pct: (winSum / totalAbs) * 100,
            color: "var(--color-success)",
            label: t("trades.tooltipWins"),
            amount: m(winSum),
          },
          {
            pct: (lossSum / totalAbs) * 100,
            color: "var(--color-destructive)",
            label: t("trades.tooltipLosses"),
            amount: m(lossSum),
          },
        ]
      : undefined;
  const avgHoldingDays =
    closedTrades.length > 0
      ? Math.round(
          closedTrades.reduce((sum, tr) => sum + tr.avgHoldingDays, 0) / closedTrades.length,
        )
      : null;

  return (
    <ReportCard
      icon={ICONS.trades}
      title={t("trades.title")}
      trend={
        log.winRate !== null
          ? {
              label: t("trades.trend", {
                pct: formatPercent(log.winRate, locale).replace("+", ""),
              }),
              tone: log.winRate >= 0.5 ? "up" : "down",
            }
          : undefined
      }
      value={m(ytdRealized)}
      valueCompact={mc(ytdRealized)}
      caption={t("trades.caption")}
      splitBar={splitBar}
      metrics={[
        { label: t("trades.metricAllTime"), value: mc(Number(log.totalRealized)) },
        {
          label: t("trades.metricAvgHold"),
          value: avgHoldingDays !== null ? t("trades.days", { count: avgHoldingDays }) : "—",
        },
        { label: t("trades.metricClosed"), value: String(closedTrades.length) },
      ]}
      href="/trades"
      openLabel={openLabel}
    />
  );
}

export async function SavingsCard({ locale }: CardProps) {
  const [t, contributions] = await Promise.all([getTranslations("Reports"), contributionsReport()]);
  const openLabel = t("open");
  if (contributions.status !== "ok") return null;

  const s = contributions.data;
  const currency = s.displayCurrency;
  const m = (n: number) => formatMoney(n, currency, locale);
  const mc = (n: number) => formatMoneyCompact(n, currency, locale);
  const netContributed = Number(s.netContributed);
  const currentValue = Number(s.currentValue);
  const gain = Math.max(0, currentValue - netContributed);
  const total = netContributed + gain;
  const splitBar =
    total > 0
      ? [
          {
            pct: (netContributed / total) * 100,
            color: "var(--color-chart-4)",
            label: t("savings.tooltipContributed"),
            amount: m(netContributed),
          },
          {
            pct: (gain / total) * 100,
            color: "var(--color-success)",
            label: t("savings.tooltipGain"),
            amount: m(gain),
          },
        ]
      : undefined;
  // `totalReturnPct` is its own basis — (value + money paid back out − gross contributed)
  // over gross contributed, i.e. income and realized gains included — so it carries its
  // basis in the label (over gross, not net, contributed). It is null where the headline gain above already is the total
  // return (a cash-inside scope); the metric is then omitted rather than filled with
  // `simpleGainPct` under the same label, which would show one figure under two bases.
  // `typeof` rather than `!== null`: an API that predates the field omits it, and that
  // must read as "no figure", not format as "NaN%".
  const totalReturnPct = typeof s.totalReturnPct === "number" ? s.totalReturnPct : null;

  return (
    <ReportCard
      icon={ICONS.savings}
      title={t("savings.title")}
      trend={
        s.xirr !== null
          ? {
              label: t("savings.trend", { pct: formatPercent(s.xirr, locale) }),
              tone: deltaToneOf(s.xirr),
            }
          : undefined
      }
      value={m(currentValue)}
      valueCompact={mc(currentValue)}
      caption={t("savings.caption")}
      splitBar={splitBar}
      gain={
        s.simpleGainPct !== null ? (
          <GainFigure
            amount={formatSignedMoney(currentValue - netContributed, currency, locale)}
            pct={formatPercent(s.simpleGainPct, locale)}
            tone={toneOf(currentValue - netContributed)}
            basis="contributed"
            amountClassName="text-sm"
            pctClassName="text-xs"
          />
        ) : undefined
      }
      metrics={[
        { label: t("savings.metricMonthly"), value: mc(Number(s.monthlyAverage)) },
        ...(totalReturnPct !== null
          ? [{ label: t("savings.metricReturn"), value: formatPercent(totalReturnPct, locale) }]
          : []),
      ]}
      href="/savings"
      openLabel={openLabel}
    />
  );
}

export async function TaxCard({ locale }: CardProps) {
  const [t, taxResult, taxRegime] = await Promise.all([
    getTranslations("Reports"),
    taxReport(),
    taxRegimeOf(),
  ]);
  const openLabel = t("open");
  const taxHolders = taxResult.status === "ok" ? taxResult.holders : [];
  const idDetailByHolder = taxRegime === "ID" ? await taxIdDetailReport() : null;
  if (taxRegime === "ID" && idDetailByHolder) {
    // Indonesian final tax headline: aggregate the per-portfolio ID breakdown returned by
    // /portfolios/:id/tax (`detail.indonesianFinalTax`) rather than recomputing it here.
    // The API is now the single source of truth.
    const currency = taxHolders[0]?.currency ?? "IDR";
    const m = (n: number) => formatMoney(n, currency, locale);
    const mc = (n: number) => formatMoneyCompact(n, currency, locale);
    let totalTax = 0;
    let totalProceeds = 0;
    let totalDividendGross = 0;
    for (const entry of taxHolders) {
      const detail = idDetailByHolder.get(entry.holder.id);
      if (!detail?.indonesianFinalTax) continue;
      totalTax += Number(detail.indonesianFinalTax.estimatedTax);
      totalProceeds += Number(detail.indonesianFinalTax.totalProceeds);
      totalDividendGross += Number(detail.indonesianFinalTax.totalDividendGross);
    }

    return (
      <ReportCard
        icon={ICONS.tax}
        title={t("tax.title")}
        trend={{ label: t("tax.idTrend"), tone: "neutral" }}
        value={m(totalTax)}
        valueCompact={mc(totalTax)}
        caption={t("tax.idCaption")}
        metrics={[
          { label: t("tax.idMetricSales"), value: mc(totalProceeds) },
          { label: t("tax.idMetricDividends"), value: mc(totalDividendGross) },
        ]}
        href="/tax"
        openLabel={openLabel}
      />
    );
  } else if (taxHolders.length > 0) {
    // German Sparerpauschbetrag only — headline mirrors tax/page.tsx's own fields,
    // no derived tax-owed math invented here.
    const currency = taxHolders[0].currency;
    const m = (n: number) => formatMoney(n, currency, locale);
    const mc = (n: number) => formatMoneyCompact(n, currency, locale);
    const sum = (f: (h: (typeof taxHolders)[number]) => number) =>
      taxHolders.reduce((acc, h) => acc + f(h), 0);
    const usedYtd = sum((h) => Number(h.allowanceUsage?.usedYtd ?? 0));
    const allowanceAnnual = sum((h) => Number(h.allowanceUsage?.allowanceAnnual ?? 0));
    const realizedGains = sum((h) => Number(h.allowanceUsage?.realizedGainsAdjusted ?? 0));
    const incomeYtd = sum((h) => Number(h.allowanceUsage?.incomeYtd ?? 0));
    const usedPct =
      allowanceAnnual > 0
        ? Math.max(0, Math.min(100, Math.round((usedYtd / allowanceAnnual) * 100)))
        : 0;

    return (
      <ReportCard
        icon={ICONS.tax}
        title={t("tax.title")}
        trend={
          allowanceAnnual > 0
            ? { label: t("tax.trend", { pct: usedPct }), tone: usedPct >= 100 ? "down" : "neutral" }
            : undefined
        }
        value={m(usedYtd)}
        valueCompact={mc(usedYtd)}
        caption={t("tax.caption")}
        splitBar={
          allowanceAnnual > 0
            ? [
                {
                  pct: usedPct,
                  color: "var(--color-chart-4)",
                  label: t("tax.tooltipUsed"),
                  amount: m(usedYtd),
                },
                {
                  pct: Math.max(0, 100 - usedPct),
                  color: "var(--color-chart-4)",
                  striped: true,
                  label: t("tax.tooltipAllowance"),
                  amount: m(allowanceAnnual),
                },
              ]
            : undefined
        }
        metrics={[
          { label: t("tax.metricRealized"), value: mc(realizedGains) },
          { label: t("tax.metricIncome"), value: mc(incomeYtd) },
        ]}
        href="/tax"
        openLabel={openLabel}
      />
    );
  }
  return null;
}

export async function GoldCard({ locale }: CardProps) {
  const [t, gold] = await Promise.all([getTranslations("Reports"), goldReport()]);
  const openLabel = t("open");
  if (!(gold.status === "ok" && (gold.data.holdings.length > 0 || gold.data.plans.length > 0)))
    return null;

  const g = gold.data;
  const currency = g.displayCurrency;
  const unrealized = Number(g.totals.unrealized);
  const measuredCost = Number(g.totals.measuredCost);
  const openPlans = g.plans.filter((p) => !p.completed).length;
  const owed = Object.entries(g.totals.outstandingByCurrency)
    .filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => formatMoneyCompact(Number(v), c, locale))
    .join(" · ");
  return (
    <ReportCard
      icon={ICONS.gold}
      title={t("gold.title")}
      value={formatMoney(Number(g.totals.value), currency, locale)}
      valueCompact={formatMoneyCompact(Number(g.totals.value), currency, locale)}
      caption={t("gold.caption")}
      gain={
        measuredCost > 0 ? (
          <GainFigure
            amount={formatSignedMoney(unrealized, currency, locale)}
            pct={formatPercent(unrealized / measuredCost, locale)}
            tone={toneOf(unrealized)}
            basis="cost"
            amountClassName="text-sm"
            pctClassName="text-xs"
          />
        ) : undefined
      }
      metrics={[
        {
          label: t("gold.metricGrams"),
          value: formatQuantity(Number(g.totals.grams), "grams", locale),
        },
        // The footer fits two figures: what is still owed when there are open plans,
        // otherwise the (zero) open-plan count.
        owed
          ? { label: t("gold.metricOwed"), value: owed }
          : { label: t("gold.metricPlans"), value: String(openPlans) },
      ]}
      href="/reports/gold"
      openLabel={openLabel}
    />
  );
}

export async function DocumentsCard() {
  const [t, taxReports] = await Promise.all([getTranslations("Reports"), taxDocumentsReport()]);
  const openLabel = t("open");
  const latestYear = taxReports.reduce<number | null>(
    (max, d) => (d.taxYear != null && (max === null || d.taxYear > max) ? d.taxYear : max),
    null,
  );
  const fromTr = taxReports.filter((d) => d.source === "pytr").length;
  const fromUpload = taxReports.length - fromTr;
  return (
    <ReportCard
      icon={ICONS.documents}
      title={t("documents.title")}
      value={String(taxReports.length)}
      caption={t("documents.caption")}
      metrics={[
        {
          label: t("documents.metricLatestYear"),
          value: latestYear !== null ? String(latestYear) : "—",
        },
        {
          label: t("documents.metricSources"),
          value: t("documents.metricSourcesValue", { fromTr, fromUpload }),
        },
      ]}
      href="/reports/documents"
      openLabel={openLabel}
    />
  );
}
