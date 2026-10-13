import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import type React from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Coins, ScrollText, PiggyBank, Receipt, FileText, Gem } from "lucide-react";
import { ReportCard } from "@/components/reports/report-card";
import { EmptyState } from "@/components/empty-state";
import { FxMissingBanner } from "@/components/fx-missing-banner";
import { collectFxMissing } from "@/lib/fx-missing";
import { PageHeaderSetter, PageTitle } from "@/components/page-header";
import {
  loadIncomeStats,
  loadGoldReport,
  loadTrades,
  loadContributions,
  loadNetworthTaxResult,
  loadTaxYearDetail,
  loadPreferences,
  loadDocuments,
} from "@/lib/server-api";
import {
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatQuantity,
  formatSignedMoney,
} from "@/lib/utils";
import { GainFigure, toneOf } from "@/components/gain-figure";
import type { TrendTone } from "@/components/reports/trend-chip";

const ICONS = {
  income: { icon: Coins, bg: "rgba(14,159,110,.12)", fg: "#0E9F6E" },
  trades: { icon: ScrollText, bg: "rgba(224,165,58,.14)", fg: "var(--gold-fg)" },
  savings: { icon: PiggyBank, bg: "rgba(124,92,252,.12)", fg: "#7C5CFC" },
  tax: { icon: Receipt, bg: "rgba(13,148,136,.12)", fg: "var(--color-chart-3)" },
  gold: { icon: Gem, bg: "rgba(224,165,58,.14)", fg: "var(--gold-fg)" },
  documents: { icon: FileText, bg: "rgba(59,130,246,.12)", fg: "#3B82F6" },
} as const;

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Reports");
  const te = await getTranslations("Empty");
  const openLabel = t("open");

  // loadPreferences() used to be awaited before anything else — a full serial round trip
  // blocking the whole page. The loaders that don't need costBasis/taxRegime are kicked
  // off immediately in parallel with prefs; only loadTrades and loadNetworthTaxResult wait on
  // prefs to resolve (they need the user's selected costBasis and taxRegime).
  const prefsPromise = loadPreferences();
  const incomePromise = loadIncomeStats();
  const contributionsPromise = loadContributions();
  const documentsPromise = loadDocuments("tax_report");
  const goldPromise = loadGoldReport();

  const prefs = await prefsPromise;
  const costBasis = prefs?.costBasisMode ?? "purchase_price";
  const taxRegime = prefs?.taxRegime ?? "DE";

  const [income, trades, contributions, taxResult, taxReports, gold] = await Promise.all([
    incomePromise,
    loadTrades(undefined, costBasis),
    contributionsPromise,
    loadNetworthTaxResult(undefined, taxRegime),
    documentsPromise,
    goldPromise,
  ]);
  const taxHolders = taxResult.status === "ok" ? taxResult.holders : [];
  // A failed loader must not masquerade as "no data" — and must not leave a silently
  // partial page. Surface the first failure (rate limit, expired session, API down) as a
  // banner above whatever cards did load.
  const failure = [income, trades, contributions, taxResult].find(
    (r) => r.status === "unauthorized" || r.status === "rate_limited" || r.status === "unavailable",
  );
  // Indonesian final tax needs the same disposals/dividendRows the Tax page itself
  // recomputes over (see tax/page.tsx) — only fetched when relevant, and only when
  // there's something to compute over.
  const idDetailByHolder =
    taxRegime === "ID" && taxHolders.length > 0 ? await loadTaxYearDetail(taxHolders) : null;

  const cards: React.ReactNode[] = [];

  // ── Income ──────────────────────────────────────────────────────────────
  if (income.status === "ok") {
    const s = income.data;
    const currency = s.displayCurrency;
    const m = (n: number) => formatMoney(n, currency, locale);
    // The footer metrics sit three-up beside the "Open ›" link — the narrowest cells on
    // the card — so they get the compact form; the full-width headline above keeps
    // full precision.
    const mc = (n: number) => formatMoneyCompact(n, currency, locale);
    // Full-year outlook (actuals-to-date + rest-of-year forecast) vs last year, not just
    // actuals-to-date vs last year — matches the /income page's own headline delta.
    const lastYearTotal = Number(s.lastYear);
    const fullYearDeltaAbs = Number(s.forecastFullYear) - lastYearTotal;
    const deltaPct = lastYearTotal > 0 ? fullYearDeltaAbs / lastYearTotal : null;
    const deltaTone: TrendTone =
      deltaPct === null || deltaPct === 0 ? "neutral" : deltaPct > 0 ? "up" : "down";

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
              color: ICONS.income.fg,
              label: t("income.tooltipReceived"),
              amount: m(thisYearAmt),
            },
            {
              pct: (remainingAmt / forecastFullYearAmt) * 100,
              color: ICONS.income.fg,
              striped: true,
              label: t("income.tooltipForecast"),
              amount: m(remainingAmt),
            },
          ]
        : undefined;

    cards.push(
      <ReportCard
        key="income"
        icon={ICONS.income.icon}
        iconBg={ICONS.income.bg}
        iconFg={ICONS.income.fg}
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
      />,
    );
  }

  // ── Realized P&L (trades) ────────────────────────────────────────────────
  if (trades.status === "ok" && trades.data.trades.length > 0) {
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

    cards.push(
      <ReportCard
        key="trades"
        icon={ICONS.trades.icon}
        iconBg={ICONS.trades.bg}
        iconFg={ICONS.trades.fg}
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
      />,
    );
  }

  // ── Savings (contributions) ─────────────────────────────────────────────
  if (contributions.status === "ok") {
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
    const totalReturnPct = s.totalReturnPct ?? s.simpleGainPct;

    cards.push(
      <ReportCard
        key="savings"
        icon={ICONS.savings.icon}
        iconBg={ICONS.savings.bg}
        iconFg={ICONS.savings.fg}
        title={t("savings.title")}
        trend={
          s.xirr !== null
            ? {
                label: t("savings.trend", { pct: formatPercent(s.xirr, locale) }),
                tone: s.xirr >= 0 ? "up" : "down",
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
              amountClassName="text-[14px]"
              pctClassName="text-[12px]"
            />
          ) : undefined
        }
        metrics={[
          { label: t("savings.metricMonthly"), value: mc(Number(s.monthlyAverage)) },
          {
            label: t("savings.metricReturn"),
            value: totalReturnPct !== null ? formatPercent(totalReturnPct, locale) : "—",
          },
        ]}
        href="/savings"
        openLabel={openLabel}
      />,
    );
  }

  // ── Tax ──────────────────────────────────────────────────────────────────
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

    cards.push(
      <ReportCard
        key="tax"
        icon={ICONS.tax.icon}
        iconBg={ICONS.tax.bg}
        iconFg={ICONS.tax.fg}
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
      />,
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

    cards.push(
      <ReportCard
        key="tax"
        icon={ICONS.tax.icon}
        iconBg={ICONS.tax.bg}
        iconFg={ICONS.tax.fg}
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
                  color: "#7C5CFC",
                  label: t("tax.tooltipUsed"),
                  amount: m(usedYtd),
                },
                {
                  pct: Math.max(0, 100 - usedPct),
                  color: "#7C5CFC",
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
      />,
    );
  }

  // ── Gold (holdings + purchase plans) ─────────────────────────────────────
  if (gold.status === "ok" && (gold.data.holdings.length > 0 || gold.data.plans.length > 0)) {
    const g = gold.data;
    const currency = g.displayCurrency;
    const unrealized = Number(g.totals.unrealized);
    const measuredCost = Number(g.totals.measuredCost);
    const openPlans = g.plans.filter((p) => !p.completed).length;
    const owed = Object.entries(g.totals.outstandingByCurrency)
      .filter(([, v]) => Number(v) !== 0)
      .map(([c, v]) => formatMoneyCompact(Number(v), c, locale))
      .join(" · ");
    cards.push(
      <ReportCard
        key="gold"
        icon={ICONS.gold.icon}
        iconBg={ICONS.gold.bg}
        iconFg={ICONS.gold.fg}
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
              amountClassName="text-[14px]"
              pctClassName="text-[12px]"
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
      />,
    );
  }

  // ── Tax reports (inbox) ──────────────────────────────────────────────────
  // Always shown (unlike the KPI cards above, which need real data to render) — this is a
  // discovery entry point to the inbox even with zero documents yet, since the upload flow
  // lives there.
  const latestYear = taxReports.reduce<number | null>(
    (max, d) => (d.taxYear != null && (max === null || d.taxYear > max) ? d.taxYear : max),
    null,
  );
  const fromTr = taxReports.filter((d) => d.source === "pytr").length;
  const fromUpload = taxReports.length - fromTr;
  cards.push(
    <ReportCard
      key="documents"
      icon={ICONS.documents.icon}
      iconBg={ICONS.documents.bg}
      iconFg={ICONS.documents.fg}
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
    />,
  );

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] ReportsPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  // Currencies with no FX rate in any of the report sources (audit B2): left out of the
  // totals on these cards, never converted 1:1.
  const fxMissing = collectFxMissing(
    income.status === "ok" ? income.data : null,
    trades.status === "ok" ? trades.data : null,
    contributions.status === "ok" ? contributions.data : null,
    gold.status === "ok" ? gold.data : null,
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <PageHeaderSetter title={t("title")} />
        <PageTitle>{t("title")}</PageTitle>
      </header>
      <FxMissingBanner currencies={fxMissing} />

      {failure && (
        <DataState
          status={failure.status as "unauthorized" | "rate_limited" | "unavailable"}
          retryAfter={retryAfterOf(failure)}
          icon={Receipt}
        />
      )}

      {cards.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 @min-[1500px]:grid-cols-3">
          {cards}
        </div>
      ) : (
        <EmptyState
          icon={Receipt}
          title={te("noPortfolioTitle")}
          description={te("noPortfolioBody")}
        />
      )}
    </div>
  );
}
