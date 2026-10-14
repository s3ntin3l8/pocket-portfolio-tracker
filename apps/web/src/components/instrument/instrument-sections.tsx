import { getTranslations } from "next-intl/server";
import { AlertCircle, AlertTriangle, Receipt, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { InstrumentPriceCard } from "@/components/instrument-price-card";
import { InstrumentIncomeCard } from "@/components/instrument-income-card";
import { CorporateActionsManager } from "@/components/corporate-actions-manager";
import { TransactionsTable, type TxRow } from "@/components/transactions-table";
import { InstrumentLotsTable } from "@/components/instrument-lots-table";
import {
  instrumentOnce,
  scopeOnce,
  anomaliesOnce,
  incomeStatsOnce,
  meOnce,
  instrumentTxOnce,
  selectedPortfolioIdOnce,
  type InstrumentTxFilters,
} from "@/components/instrument/instrument-data";
import { formatMoney, formatPercent, rowAnomalyCounts } from "@/lib/utils";
import { lastPriceInfo } from "@/lib/instrument-price";

/*
 * One async server component per streamed instrument section. The page has already gated
 * on `instrumentOnce(id)` (not-found / error replace the page), so `instrument` is present
 * here; each section awaits only its own request-cached loaders from ./instrument-data.
 */

type SectionProps = { id: string; locale: string };

async function loadInstrument(id: string) {
  const result = await instrumentOnce(id);
  return result.status === "ok" ? result.data : null;
}

/** The price hero + chart, from the initial (1Y) candle window. */
export async function InstrumentPriceSection({ id }: { id: string }) {
  const [t, data] = await Promise.all([getTranslations("Instrument"), loadInstrument(id)]);
  if (!data) return null;
  const { instrument, history } = data;
  // The price hero's "Last price · today's change" headline — derived once from the initial
  // (1Y) candle window, independent of `HoldingValuation.dayChange` so it works the same
  // whether or not the instrument is currently held.
  const lastPrice = lastPriceInfo(history, instrument.currency);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("priceHistory")}</CardTitle>
      </CardHeader>
      <CardContent>
        <InstrumentPriceCard
          instrumentId={id}
          initialHistory={history}
          currency={instrument.currency}
          lastPrice={lastPrice}
        />
      </CardContent>
    </Card>
  );
}

/** Open lots (only when the active scope holds any). */
export async function InstrumentLotsSection({ id }: { id: string }) {
  const [t, data, scope] = await Promise.all([
    getTranslations("Instrument"),
    loadInstrument(id),
    scopeOnce(id),
  ]);
  if (!data) return null;
  const holding = scope.holding;
  const lots = holding?.lots ?? [];
  if (lots.length === 0) return null;
  const lotCurrency = holding?.currency ?? data.instrument.currency;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("openLots")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <InstrumentLotsTable lots={lots} currency={lotCurrency} />
      </CardContent>
    </Card>
  );
}

/**
 * This instrument's slice of the existing income analytics — reused as-is (same lifetime
 * `byInstrument` total and trailing `yields` the Income screen's YieldsTable already
 * renders), not a new aggregation.
 */
export async function InstrumentIncomeSection({ id, locale }: SectionProps) {
  const [t, data, incomeStatsResult] = await Promise.all([
    getTranslations("Instrument"),
    loadInstrument(id),
    incomeStatsOnce(),
  ]);
  if (!data) return null;
  const { instrument } = data;
  const incomeStats = incomeStatsResult.status === "ok" ? incomeStatsResult.data : null;
  const instrumentIncome = incomeStats?.byInstrument.find((i) => i.instrumentId === id) ?? null;
  const instrumentYield = incomeStats?.yields.find((y) => y.instrumentId === id) ?? null;
  return (
    <InstrumentIncomeCard
      title={t("incomeCardTitle")}
      dividendsReceived={
        incomeStats && instrumentIncome
          ? formatMoney(Number(instrumentIncome.total), incomeStats.displayCurrency, locale)
          : null
      }
      receivedCaption={t("incomeReceivedCaption")}
      emptyMessage={t("incomeEmpty")}
      yieldOnCost={
        instrumentYield?.yieldOnCost != null
          ? formatPercent(Number(instrumentYield.yieldOnCost), locale)
          : null
      }
      yieldTitle={t("yieldOnCostLabel")}
      yieldCaption={t("yieldOnCostCaption")}
      bondInfo={
        instrument.assetClass === "bond" &&
        instrument.couponRate != null &&
        instrument.maturityDate != null
          ? {
              label: t("bondTermsLabel"),
              couponRate: formatPercent(Number(instrument.couponRate), locale),
              maturityDate: new Date(`${instrument.maturityDate}T00:00:00`).toLocaleDateString(
                locale,
                { year: "numeric", month: "short", day: "numeric" },
              ),
            }
          : null
      }
    />
  );
}

/**
 * Flat heading + TransactionsTable, matching Activity's own layout exactly (#585) — no
 * outer Card here: DesktopTable already renders its own card-styled box, so wrapping it in
 * a second Card doubled the boxing and flushed the filter chips/search bar against the
 * outer card's edge instead of reading as a toolbar above the table.
 */
export async function InstrumentTransactionsSection({
  id,
  filters,
}: {
  id: string;
  filters: InstrumentTxFilters;
}) {
  const [t, ta, scope, allAnomalies, txResult, selectedId] = await Promise.all([
    getTranslations("Instrument"),
    getTranslations("Anomalies"),
    scopeOnce(id),
    anomaliesOnce(),
    instrumentTxOnce(id, filters),
    selectedPortfolioIdOnce(),
  ]);
  const aggregate = selectedId === null;
  const { type: typeFilter, year: yearFilter, q: searchQuery, status: statusFilter } = filters;

  const txRows: TxRow[] = txResult.status === "ok" ? txResult.rows : [];
  const txTotal = txResult.status === "ok" ? txResult.total : 0;
  const txYears = txResult.status === "ok" ? (txResult.years ?? []) : [];
  const txDraftCount = txResult.status === "ok" ? txResult.draftCount : undefined;
  const hasActiveTxFilter = Boolean(typeFilter || yearFilter || searchQuery || statusFilter);

  // Filter anomalies to those affecting this specific instrument. Portfolio-scoped
  // anomalies (reconciliation_gap, position_gap) are NOT instrument-specific — they used to
  // be included unconditionally here (`|| a.scope === "portfolio"`), which leaked an
  // unrelated portfolio-wide cash/position warning onto every single instrument's page.
  // They already have their own dedicated banner on Holdings/Transactions; this page only
  // needs anomalies that actually attach to one of this instrument's own transactions.
  const instrumentAnomalies = (allAnomalies ?? []).filter((a) => a.instrumentId === id);
  // Same dedup-by-transaction, worst-severity-wins count used everywhere else (Holdings,
  // Transactions) — see apps/web/src/lib/utils.ts `rowAnomalyCounts`.
  const { errors: instrumentAnomalyErrors, warnings: instrumentAnomalyWarnings } =
    rowAnomalyCounts(instrumentAnomalies);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("transactions")}</h2>
        {(instrumentAnomalyErrors > 0 || instrumentAnomalyWarnings > 0) && (
          <span
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              instrumentAnomalyErrors > 0
                ? "bg-destructive/10 text-destructive"
                : "bg-warning/10 text-warn-strong"
            }`}
          >
            {instrumentAnomalyErrors > 0 ? (
              <AlertCircle className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            {instrumentAnomalyErrors > 0
              ? ta("bannerError", { count: instrumentAnomalyErrors })
              : ta("bannerWarning", { count: instrumentAnomalyWarnings })}
          </span>
        )}
      </div>
      {txTotal > 0 || hasActiveTxFilter ? (
        <TransactionsTable
          rows={txRows}
          showPortfolio={aggregate}
          anomalies={instrumentAnomalies}
          showFilterBanners={false}
          scopeCurrency={scope.displayCurrency}
          years={txYears}
          typeFilter={typeFilter}
          yearFilter={yearFilter}
          searchQuery={searchQuery}
          portfolioId={selectedId ?? undefined}
          total={txTotal}
          instrumentId={id}
          statusFilter={statusFilter}
          draftCount={txDraftCount}
        />
      ) : (
        <EmptyState
          icon={Receipt}
          title={t("noTransactions")}
          description={t("noTransactionsBody")}
        />
      )}
    </div>
  );
}

export async function InstrumentCorporateActionsSection({ id }: { id: string }) {
  const [t, data, me] = await Promise.all([
    getTranslations("Instrument"),
    loadInstrument(id),
    meOnce(),
  ]);
  if (!data) return null;
  const isAdmin = Boolean(me?.isAdmin);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("corporateActions")}</CardTitle>
      </CardHeader>
      <CardContent>
        <CorporateActionsManager items={data.corporateActions} isAdmin={isAdmin} />
      </CardContent>
    </Card>
  );
}

/** Sidebar: position stats (the page wraps it in the sticky column). */
export async function InstrumentPositionSection({ id, locale }: SectionProps) {
  const [t, data, scope] = await Promise.all([
    getTranslations("Instrument"),
    loadInstrument(id),
    scopeOnce(id),
  ]);
  if (!data) return null;
  const { instrument } = data;

  // Your position in this instrument (null / zero-quantity = not held in the active scope).
  const holding = scope.holding;
  const hasPosition = holding !== null && Number(holding.quantity) !== 0;
  const pnlDisplay =
    holding?.unrealizedPnLDisplay != null ? Number(holding.unrealizedPnLDisplay) : null;
  const costBasisDisplay = holding ? Number(holding.costBasisDisplay) : 0;
  const pnlPct =
    pnlDisplay !== null && costBasisDisplay !== 0 ? pnlDisplay / costBasisDisplay : undefined;
  const qtyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 });

  // This position's market value ÷ the total market value of every holding in the active
  // scope — reuses `loadInstrumentScope`'s already-fetched holdings list (no new fetch).
  const marketValueDisplay =
    holding?.marketValueDisplay != null ? Number(holding.marketValueDisplay) : null;
  const portfolioWeight =
    marketValueDisplay !== null && scope.totalMarketValueDisplay
      ? marketValueDisplay / scope.totalMarketValueDisplay
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("position")}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasPosition && holding ? (
          <div className="grid grid-cols-1 gap-2.5 sm:gap-4">
            <StatCard
              label={t("marketValueLabel")}
              value={
                marketValueDisplay !== null
                  ? formatMoney(marketValueDisplay, scope.displayCurrency, locale)
                  : "—"
              }
            />
            <StatCard label={t("quantityLabel")} value={qtyFmt.format(Number(holding.quantity))} />
            <StatCard
              label={t("avgCostLabel")}
              value={formatMoney(
                Number(holding.avgCost),
                holding.currency ?? instrument.currency,
                locale,
              )}
            />
            <StatCard
              label={t("unrealizedPnl")}
              value={
                pnlDisplay !== null ? formatMoney(pnlDisplay, scope.displayCurrency, locale) : "—"
              }
              delta={pnlPct !== undefined ? formatPercent(pnlPct, locale) : undefined}
              deltaTone={pnlDisplay === null ? "neutral" : pnlDisplay >= 0 ? "up" : "down"}
            />
            <StatCard
              label={t("portfolioWeightLabel")}
              value={portfolioWeight !== null ? `${(portfolioWeight * 100).toFixed(1)}%` : "—"}
            />
          </div>
        ) : (
          <EmptyState icon={Wallet} title={t("noPosition")} description={t("noPositionBody")} />
        )}
      </CardContent>
    </Card>
  );
}
