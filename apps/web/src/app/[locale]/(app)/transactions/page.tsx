import { retryAfterOf, type DataFailureStatus } from "@/lib/data-status";
import { DataState } from "@/components/data-state";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Plus, Receipt } from "lucide-react";
import { FxMissingBanner } from "@/components/fx-missing-banner";
import { collectFxMissing } from "@/lib/fx-missing";
import { EmptyState } from "@/components/empty-state";
import { TransactionsTable, type TxRow } from "@/components/transactions-table";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ExportDocumentsButton } from "@/components/export-documents-button";
import { AddTransactionMenu } from "@/components/add-transaction-menu";
import { RecentImportsSection } from "@/components/recent-imports-section";
import { PageHeader } from "@/components/page-header";
import { PortfolioFormDialog } from "@/components/portfolio-form-dialog";
import { Button } from "@/components/ui/button";
import {
  loadImports,
  loadPortfolioList,
  loadNetworthTransactionsPaginated,
  loadTransactionsPaginated,
  loadMe,
} from "@/lib/server-api";
import {
  getScopeSelection,
  resolveEffectiveScope,
  loadHolderTransactions,
  loadScopeAnomalies,
} from "@/lib/server-api/_shared";
import type { Anomaly } from "@portfolio/api-client";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";
const PAGE_SIZE = 25;

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{
    page?: string;
    type?: string;
    year?: string;
    q?: string;
    status?: string;
  }>;
}) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Transactions");
  const te = await getTranslations("Empty");
  const tf = await getTranslations("PortfolioForm");

  // The scope of this ledger: one portfolio, one holder's portfolios, or the
  // all-portfolios aggregate. It is resolved as a discriminated value — asking for "the
  // selected portfolio" answers null for BOTH "all portfolios" and "a holder scope", and
  // that conflation is what made this page aggregate a holder scope (audit R4-C1).
  const scope = await getScopeSelection();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp?.page ?? "1"));
  const typeFilter = (sp?.type as string) ?? undefined;
  const yearFilter = (sp?.year as string) ?? undefined;
  const searchQuery = (sp?.q as string) ?? undefined;
  const statusFilter = sp?.status === "draft" ? "draft" : undefined;

  // Fire ALL API calls immediately — no serial dependency on portfolios.
  const importsPromise = loadImports();
  const portfolioListPromise = loadPortfolioList();

  let status: "ok" | DataFailureStatus;
  let retryAfter: number | null = null;
  let rows: TxRow[] = [];
  let total = 0;
  let txSummary: {
    totalInvested: string;
    totalProceeds: string;
    totalIncome: string;
    fxMissingCurrencies?: string[];
  } | null = null;
  let txYears: string[] = [];
  let draftCount: number | undefined;
  let singlePortfolio: { id: string; name: string; documentRetention: boolean } | null = null;
  let anomalies: Anomaly[] | null = null;
  let scopeCurrency = "IDR";

  const me = await loadMe();
  const isAdmin = Boolean(me?.isAdmin);

  // A holder scope only counts for a holder that owns ≥2 portfolios (the switcher's rule) —
  // the same qualification every other scope-aware page applies. Resolving it needs the
  // portfolio list, so only this branch waits for it.
  const effectiveScope =
    scope.kind === "holder" ? await resolveEffectiveScope(await portfolioListPromise) : scope;

  if (effectiveScope.kind === "portfolio") {
    const [txResult, anomalyResult] = await Promise.all([
      loadTransactionsPaginated(
        effectiveScope.portfolioId,
        page,
        PAGE_SIZE,
        undefined,
        typeFilter,
        yearFilter,
        searchQuery,
        undefined,
        statusFilter,
      ),
      loadScopeAnomalies(effectiveScope),
    ]);
    status = txResult.status;
    retryAfter = retryAfterOf(txResult);
    if (txResult.status === "ok") {
      rows = txResult.rows;
      total = txResult.total;
      txSummary = txResult.summary ?? null;
      txYears = txResult.years ?? [];
      draftCount = txResult.draftCount;
    }
    anomalies = anomalyResult;
  } else if (effectiveScope.kind === "holder") {
    // A holder scope lists the holder's own portfolios only — never the other holders'
    // rows. The loader hands back the holder's COMPLETE filtered set (the table pages
    // through it itself), so no unscoped request can slip into this ledger.
    scopeCurrency = me?.displayCurrency ?? "IDR";
    const [txResult, anomalyResult] = await Promise.all([
      loadHolderTransactions(effectiveScope.holderId, {
        type: typeFilter,
        year: yearFilter,
        q: searchQuery,
        status: statusFilter,
        convertTo: scopeCurrency,
      }),
      loadScopeAnomalies(effectiveScope),
    ]);
    status = txResult.status;
    retryAfter = retryAfterOf(txResult);
    if (txResult.status === "ok") {
      rows = txResult.rows;
      total = txResult.total;
      txSummary = null;
      txYears = txResult.years;
    }
    anomalies = anomalyResult;
  } else {
    const [result, anomalyResult] = await Promise.all([
      loadNetworthTransactionsPaginated(
        page,
        PAGE_SIZE,
        typeFilter,
        yearFilter,
        searchQuery,
        undefined,
        statusFilter,
      ),
      loadScopeAnomalies(effectiveScope),
    ]);
    status = result.status;
    retryAfter = retryAfterOf(result);
    rows = result.rows;
    total = result.total;
    if (result.status === "ok") {
      txSummary = result.summary ?? null;
      txYears = result.years ?? [];
      draftCount = result.draftCount;
    }
    scopeCurrency = me?.displayCurrency ?? "IDR";
    anomalies = anomalyResult;
  }

  // Newest first (already ordered by the backend for paginated queries).
  rows = [...rows].sort((a, b) => b.executedAt.localeCompare(a.executedAt));

  // Portfolio metadata from the parallel-fetched list.
  const portfolioList = await portfolioListPromise;
  const selectedId = effectiveScope.kind === "portfolio" ? effectiveScope.portfolioId : null;
  if (selectedId && portfolioList.length > 0) {
    const selected = portfolioList.find((p) => p.id === selectedId) ?? portfolioList[0];
    singlePortfolio = {
      id: selected.id,
      name: selected.name,
      documentRetention: selected.documentRetention,
    };
    scopeCurrency = selected.baseCurrency;
  }

  // The Portfolio column belongs to every scope that spans more than one portfolio: the
  // aggregate and a holder with several portfolios.
  const showPortfolio = effectiveScope.kind !== "portfolio";

  // How many rows the server would still serve for this scope. It is 0 under a holder
  // scope: the whole scope is loaded here, and the table's two client-side "give me more"
  // paths — "load more" and "select all matching" — both ask the API for rows BEYOND what
  // the table was handed. Those endpoints have no holder filter, so offering them would
  // pull in other holders' transactions. The loaded set is complete, so nothing is lost.
  const serverRemainder = effectiveScope.kind === "holder" ? 0 : total;

  // Import history is embedded here (the standalone /import route was retired). Shown as
  // a collapsed section whenever any imports exist — including for a portfolio that has
  // only pending drafts and no confirmed transactions yet.
  const imports = await importsPromise;

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] TransactionsPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
        scope: effectiveScope.kind,
        page,
        transactionCount: rows.length,
        total,
      }),
    );
  }

  const importsSection =
    imports.length > 0 ? <RecentImportsSection items={imports} portfolios={portfolioList} /> : null;

  // Plain-data CSV of the visible transactions (built client-side on click).
  const exportHeaders = [
    "Date",
    "Type",
    "Symbol",
    "Name",
    "Quantity",
    "Price",
    "Currency",
    "Source",
    ...(showPortfolio ? ["Portfolio"] : []),
  ];
  const exportRows: (string | number)[][] = rows.map((r) => [
    r.executedAt.slice(0, 10),
    r.type,
    r.instrument?.symbol ?? "",
    r.instrument?.name ?? "",
    r.quantity,
    r.price,
    r.currency,
    r.source,
    ...(showPortfolio ? [r.portfolioName ?? ""] : []),
  ]);

  // Export moved out of the heading into the table's filter toolbar (it exports the
  // table, so it belongs next to the table's own search/filters, right of the search
  // input) — same treatment as Holdings. Adding is handled by the global add-entry menu
  // in the app-shell header, so no Add button lives here either.
  const actions = (
    <>
      <ExportCsvButton
        filename="transactions.csv"
        headers={exportHeaders}
        rows={exportRows}
        label={t("exportCsv")}
        iconOnly
        className="shrink-0 md:size-8"
      />
      {singlePortfolio?.documentRetention && (
        <ExportDocumentsButton
          portfolioId={singlePortfolio.id}
          portfolioName={singlePortfolio.name}
          label={t("exportDocuments")}
          iconOnly
          className="shrink-0 md:size-8"
        />
      )}
    </>
  );

  const heading = <PageHeader title={t("title")} />;

  // No page-number navigation — replaced with a "Load more" button inside the table
  // component that fetches the next server page and appends progressively.

  if (status !== "ok") {
    return (
      <div className="space-y-5">
        {heading}
        <DataState status={status} retryAfter={retryAfter} />
      </div>
    );
  }

  if (rows.length === 0) {
    const hasActiveFilter = typeFilter || yearFilter || searchQuery;
    // When a filter/search is active, fall through to the table — it shows its own
    // "No transactions match your search" message with the filter controls still visible.
    if (!hasActiveFilter) {
      // Zero portfolios: there is nothing to add a transaction TO (the form would open
      // with `portfolioId=""`), so the CTA is "create a portfolio", not "add".
      if (portfolioList.length === 0) {
        return (
          <div className="space-y-5">
            {heading}
            <EmptyState
              icon={Receipt}
              title={te("noPortfolioTitle")}
              description={te("noPortfolioBody")}
              action={
                <PortfolioFormDialog
                  mode="create"
                  trigger={
                    <Button>
                      <Plus className="size-4" />
                      {tf("new")}
                    </Button>
                  }
                />
              }
            />
          </div>
        );
      }
      return (
        <div className="space-y-5">
          {heading}
          <EmptyState
            icon={Receipt}
            title={te("noTransactionsTitle")}
            description={te("noTransactionsBody")}
            action={<AddTransactionMenu isAdmin={isAdmin} />}
          />
          {importsSection}
        </div>
      );
    }
  }

  // Currencies with no FX rate (audit B2): excluded from the converted totals; rows in
  // them stay in their native currency.
  const fxMissing = collectFxMissing(
    txSummary,
    rows.filter((r) => r.fxMissing).map((r) => r.currency),
  );

  return (
    <div className="space-y-5">
      {heading}
      <FxMissingBanner currencies={fxMissing} />
      <TransactionsTable
        rows={rows}
        showPortfolio={showPortfolio}
        anomalies={anomalies ?? []}
        portfolios={portfolioList}
        scopeCurrency={scopeCurrency}
        summary={txSummary}
        years={txYears}
        typeFilter={typeFilter}
        yearFilter={yearFilter}
        searchQuery={searchQuery}
        portfolioId={singlePortfolio?.id ?? undefined}
        total={serverRemainder}
        statusFilter={statusFilter}
        draftCount={draftCount}
        actions={actions}
      />
      {importsSection}
    </div>
  );
}
