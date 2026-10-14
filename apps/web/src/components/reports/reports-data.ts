import "server-only";
import { cache } from "react";
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

/*
 * Request-scoped (React `cache`) loaders behind the Reports page. Each card streams in
 * behind its own <Suspense> and awaits only the loader it needs, while <ReportsStatus>
 * (failure + FX-missing banners) reads several of them — `cache` makes every consumer in
 * one render share a single in-flight API call, so splitting the page costs no extra
 * requests. The page calls {@link startReportsLoads} first so all fetches overlap.
 */

export const prefsReport = cache(() => loadPreferences());
export const incomeReport = cache(() => loadIncomeStats());
export const contributionsReport = cache(() => loadContributions());
export const goldReport = cache(() => loadGoldReport());
export const taxDocumentsReport = cache(() => loadDocuments("tax_report"));

/** The user's saved cost-basis mode / tax regime (only trades and tax need them). */
export const costBasisOf = cache(
  async () => (await prefsReport())?.costBasisMode ?? "purchase_price",
);
export const taxRegimeOf = cache(async () => (await prefsReport())?.taxRegime ?? "DE");

export const tradesReport = cache(async () => loadTrades(undefined, await costBasisOf()));
export const taxReport = cache(async () => loadNetworthTaxResult(undefined, await taxRegimeOf()));

/**
 * Indonesian final tax needs the same disposals/dividendRows the Tax page itself recomputes
 * over (see tax/page.tsx) — only fetched when relevant, and only when there's something to
 * compute over. `null` otherwise.
 */
export const taxIdDetailReport = cache(async () => {
  if ((await taxRegimeOf()) !== "ID") return null;
  const taxResult = await taxReport();
  const holders = taxResult.status === "ok" ? taxResult.holders : [];
  return holders.length > 0 ? loadTaxYearDetail(holders) : null;
});

/** Fire every independent loader without awaiting, so they run in parallel. */
export function startReportsLoads(): void {
  void incomeReport();
  void contributionsReport();
  void goldReport();
  void taxDocumentsReport();
  void tradesReport();
  void taxReport();
}
