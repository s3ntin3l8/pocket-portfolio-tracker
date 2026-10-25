import { Suspense } from "react";
import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ExportCsvButton } from "@/components/export-csv-button";
import { AddTransactionMenu } from "@/components/add-transaction-menu";
import { PortfolioFormDialog } from "@/components/portfolio-form-dialog";
import { PositionsPanel } from "@/components/holdings/positions-panel";
import {
  HoldingsHeroSection,
  startHoldingsHeroData,
} from "@/components/holdings/holdings-hero-section";
import { HoldingsHeroSkeleton } from "@/components/holdings/holdings-hero-skeleton";
import { HoldingsPageCommands } from "@/components/holdings/holdings-page-commands";
import { HoldingsAnomalySection } from "@/components/holdings/holdings-anomaly-section";
import { HoldingsSidebar } from "@/components/holdings/holdings-sidebar";
import { FxMissingBanner } from "@/components/fx-missing-banner";
import { collectFxMissing } from "@/lib/fx-missing";
import {
  loadHoldings,
  loadNetWorth,
  loadPreferences,
  loadMe,
  loadAnomalies,
  loadNetworthAnomalies,
} from "@/lib/server-api";
import { getScopeSelection, legacyScopeValue } from "@/lib/server-api/_shared";
import { PageHeader } from "@/components/page-header";
import { PageWithRail } from "@/components/page-with-rail";

const CLASS_TABS = [
  "all",
  "equity",
  "etf",
  "gold",
  "bond",
  "mutual_fund",
  "crypto",
  "cash",
] as const;

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function HoldingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ portfolio?: string; scope?: string; filter?: string; range?: string }>;
}) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  const sp = await searchParams;
  const { portfolio: portfolioParam, filter: filterParam, range: rangeParam } = sp;
  setRequestLocale(locale);
  const t = await getTranslations("Holdings");
  const te = await getTranslations("Empty");
  const tf = await getTranslations("PortfolioForm");

  // `?portfolio=<id>` was the Holdings page's own drill-in parameter. It overrode ONLY the
  // positions table while the hero chart, the allocation donut and the sidebar net worth
  // followed `?scope=` — two different scopes on one screen, with nothing saying so (audit
  // R4-C2). `?scope=p:<id>` is the documented encoding, so a legacy deep link is translated
  // to it (a redirect) instead of being read as a second, parallel scope.
  const legacyScope = legacyScopeValue({ scope: sp.scope, portfolio: portfolioParam });
  if (legacyScope) {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(sp)) {
      if (value && key !== "portfolio" && key !== "scope") query[key] = value;
    }
    query.scope = legacyScope;
    redirect({ href: { pathname: "/holdings", query }, locale });
  }

  // The page's scope — the `?scope=` the proxy surfaced, or the `pf` cookie fallback. Every
  // part of this page (positions, hero, allocation, sidebar) follows it.
  const scope = await getScopeSelection();
  const portfolioId = scope.kind === "portfolio" ? scope.portfolioId : undefined;

  // Blocking path: only what decides WHICH page this is (error / empty / table) plus the
  // net-worth payload — loadHoldings and loadNetWorth share one cached API call. Everything
  // else (hero history, anomalies, `me`) is independent and streams in behind <Suspense>
  // below, so the positions table and the allocation rail no longer wait on it.
  // Cost basis is a single global preference (Settings → Investing), not a per-page toggle —
  // threaded into every cost-basis-sensitive loader.
  // The streamed sections' loaders are started NOW (not awaited) so they overlap with the
  // blocking fetches below instead of waterfalling after them: the hero via an explicit
  // promise prop, the anomalies via their request-`cache()`d loaders (the section's own
  // call returns the same in-flight promise).
  const heroData = startHoldingsHeroData(rangeParam);
  void (portfolioId ? loadAnomalies(portfolioId) : loadNetworthAnomalies());
  const prefs = await loadPreferences();
  const costBasis = prefs?.costBasisMode ?? "purchase_price";

  const [result, netWorthResult] = await Promise.all([
    loadHoldings(costBasis),
    loadNetWorth(costBasis),
  ]);

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] HoldingsPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  // Open positions only (computeHoldings also returns closed, zero-quantity ones).
  const holdings =
    result.status === "ok" ? result.holdings.filter((h) => Number(h.quantity) !== 0) : [];
  const currency = result.status === "ok" ? result.displayCurrency : "IDR";

  // Cash for cash-inclusive portfolios (cashTracked = cashCounted && hasCashMovement).
  // `cash` is native per currency; `cashDisplay` is the same balances converted into the
  // display currency by the API (a currency with no FX rate is absent from it).
  const cash = result.status === "ok" ? result.cash : {};
  const cashDisplay = result.status === "ok" ? result.cashDisplay : {};
  const cashTracked = result.status === "ok" ? result.cashTracked : false;
  const hasCash = cashTracked && Object.values(cash).some((v) => Number(v) !== 0);

  // Count holdings per asset class to determine which tabs to show. Reference
  // (Pocket Prototype.dc.html) only renders a pill for classes actually held in the
  // current scope — not a fixed set with disabled placeholders for empty ones.
  const classCounts = holdings.reduce<Record<string, number>>((acc, h) => {
    const c = h.instrument?.assetClass;
    if (c) acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  const visibleClassTabs = CLASS_TABS.filter(
    (key) => key === "all" || (key === "cash" ? hasCash : (classCounts[key] ?? 0) > 0),
  );

  // Per-unit avgCost/price are native quotes (labeled by PriceCurrency); position
  // value/P&L are in the display currency (the trailing Currency column).
  const exportRows: (string | number)[][] = [
    ...holdings.map((h) => [
      h.instrument?.symbol ?? "",
      h.instrument?.name ?? "",
      h.instrument?.assetClass ?? "",
      Number(h.quantity),
      h.instrument?.unit ?? "",
      h.avgCost,
      h.price ?? "",
      h.currency ?? currency,
      h.marketValueDisplay ?? "",
      h.unrealizedPnLDisplay ?? "",
      currency,
    ]),
    // Cash rows for cash-inclusive portfolios (one row per currency). Like the holdings
    // rows, MarketValue/Currency are in the display currency — empty when the cash
    // currency has no FX rate, exactly like an fxMissing holding (writing the native
    // amount there would label it with the wrong currency). For cash, Quantity is the
    // native balance (an amount, not a share count) and PriceCurrency names its currency.
    ...Object.entries(cash)
      .filter(([, v]) => Number(v) !== 0)
      .map(([ccy, balance]) => [
        "Cash",
        t("cash"),
        "cash",
        balance,
        "",
        "",
        "",
        ccy,
        cashDisplay[ccy] ?? "",
        "",
        currency,
      ]),
  ];

  // Export moved out of the heading into the positions toolbar (it exports the table, so
  // it belongs next to the table's own search/filters — see PositionsPanel below).
  // Rendered unconditionally there rather than gated on `holdings.length > 0` as before:
  // that guard also hid it for a cash-only portfolio, even though `exportRows` already
  // included its cash rows.
  // Explicit key: this element is created in the server component and handed to the client
  // `PositionsPanel` → `TableToolbar`; once serialized across the RSC boundary React treats it as
  // a list child there, and a keyless one trips the "unique key" warning (audit E8).
  const exportButton = (
    <ExportCsvButton
      key="export-csv"
      filename="holdings.csv"
      headers={[
        "Symbol",
        "Name",
        "AssetClass",
        "Quantity",
        "Unit",
        "AvgCost",
        "Price",
        "PriceCurrency",
        "MarketValue",
        "UnrealizedPnL",
        "Currency",
      ]}
      rows={exportRows}
      label={t("exportCsv")}
      iconOnly
      className="shrink-0 md:size-8"
    />
  );

  const Heading = <PageHeader title={t("title")} mobileTitle={t("titleMobile")} />;

  if (result.status !== "ok" && result.status !== "empty") {
    return (
      <div className="space-y-5">
        {Heading}
        <DataState status={result.status} retryAfter={retryAfterOf(result)} />
      </div>
    );
  }

  if (holdings.length === 0 && !hasCash) {
    // Only this branch needs `me` (the add menu's admin-only entries) — not the happy path.
    const isAdmin = Boolean((await loadMe())?.isAdmin);
    return (
      <div className="space-y-5">
        {Heading}
        <EmptyState
          icon={Layers}
          title={result.status === "empty" ? te("noPortfolioTitle") : te("noHoldingsTitle")}
          description={result.status === "empty" ? te("noPortfolioBody") : te("noHoldingsBody")}
          action={
            result.status === "empty" ? (
              <PortfolioFormDialog
                mode="create"
                trigger={
                  <Button>
                    <Plus className="size-4" />
                    {tf("new")}
                  </Button>
                }
              />
            ) : (
              <AddTransactionMenu autoOpenFromParams={false} isAdmin={isAdmin} />
            )
          }
        />
      </div>
    );
  }

  const summary = netWorthResult.status === "ok" ? netWorthResult.data : null;

  // Currencies with no FX rate (audit B2): their holdings are left out of the totals.
  const fxMissing = collectFxMissing(summary, result.status === "ok" ? result : null);

  return (
    <div className="space-y-5">
      {Heading}
      <FxMissingBanner currencies={fxMissing} />
      <HoldingsPageCommands />

      {/* ── Hero chart: full-width above the table; streams in behind a skeleton ── */}
      {summary && (
        <Suspense fallback={<HoldingsHeroSkeleton />}>
          <HoldingsHeroSection
            summary={summary}
            data={heroData}
            portfolioParam={portfolioId}
            benchmarkSymbol={prefs?.benchmarkSymbols?.[0]?.symbol ?? "^GSPC"}
          />
        </Suspense>
      )}

      <PageWithRail>
        {/* ── Main column: anomaly banners + tabs + table ── */}
        <div className="space-y-5">
          <Suspense fallback={null}>
            <HoldingsAnomalySection portfolioParam={portfolioId} locale={locale} />
          </Suspense>

          <PositionsPanel
            rows={holdings}
            currency={currency}
            cash={hasCash ? cash : undefined}
            cashDisplay={cashDisplay}
            classTabs={visibleClassTabs}
            actions={exportButton}
            initialAtCostOnly={filterParam === "at-cost"}
          />
        </div>

        {/* ── Sidebar: value stats + allocation donut (sticky on wide containers) ── */}
        {summary && <HoldingsSidebar summary={summary} locale={locale} />}
      </PageWithRail>
    </div>
  );
}
