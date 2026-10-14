import "server-only";
import { cache } from "react";
import {
  loadInstrumentResult,
  loadInstrumentScope,
  loadAnomalies,
  loadPreferences,
  loadMe,
  loadTransactionsPaginated,
  loadNetworthTransactionsPaginated,
  getSelectedPortfolioId,
} from "@/lib/server-api";

/*
 * Request-scoped (React `cache`) loaders behind the instrument page. The page gates on the
 * instrument itself (not-found / error replace the whole page) and streams every other
 * section behind its own <Suspense>; each section awaits only the loader(s) it needs and
 * `cache` makes every consumer in one render share a single in-flight API call, so
 * splitting the page costs no extra requests. The page calls {@link startInstrumentLoads}
 * first so all fetches overlap.
 */

export const PAGE_SIZE = 25;

export const instrumentOnce = cache((id: string) => loadInstrumentResult(id));
export const prefsOnce = cache(() => loadPreferences());
export const meOnce = cache(() => loadMe());
export const selectedPortfolioIdOnce = cache(() => getSelectedPortfolioId());
export const anomaliesOnce = cache(() => loadAnomalies());
// Re-exported (not redefined) so React `cache()` has a single key for the income payload
// across the Income and Instrument routes.
import { incomeStatsOnce } from "@/components/income/income-data";
export { incomeStatsOnce };

/**
 * Cost basis is a single global preference — threaded into loadInstrumentScope, which
 * previously silently defaulted to purchase_price regardless of the user's choice on
 * Holdings (a real correctness gap: instrument P&L could disagree with holdings P&L).
 */
export const costBasisOnce = cache(
  async () => (await prefsOnce())?.costBasisMode ?? "purchase_price",
);

/** This instrument's slice of the active scope (position, lots, display currency). */
export const scopeOnce = cache(async (id: string) =>
  loadInstrumentScope(id, await costBasisOnce()),
);

export interface InstrumentTxFilters {
  page: number;
  type?: string | undefined;
  year?: string | undefined;
  q?: string | undefined;
  status?: "draft" | undefined;
}

/**
 * Same aggregate-vs-single-portfolio branch Activity uses for its own paginated fetch —
 * scoped down to this instrument via `instrumentId` so filter chips/year/search/"Load more"
 * all operate server-side on this instrument's own transactions, not the whole scope (#585).
 * Keyed on primitives (cache compares args by identity) so every consumer shares one call.
 */
const instrumentTxCached = cache(
  async (
    id: string,
    page: number,
    type: string | undefined,
    year: string | undefined,
    q: string | undefined,
    status: "draft" | undefined,
  ) => {
    const selectedId = await selectedPortfolioIdOnce();
    return selectedId === null
      ? loadNetworthTransactionsPaginated(page, PAGE_SIZE, type, year, q, id, status)
      : loadTransactionsPaginated(
          selectedId,
          page,
          PAGE_SIZE,
          undefined,
          type,
          year,
          q,
          id,
          status,
        );
  },
);

/**
 * Object-arg facade over the cached loader. `cache()` compares each argument with
 * `Object.is`, so an object-literal arg would be a fresh key every call and never dedupe;
 * the primitives are therefore spread positionally into ONE private call site here. Invariant:
 * every caller goes through this function, so the argument order below is the only place it
 * can drift.
 */
export function instrumentTxOnce(id: string, f: InstrumentTxFilters) {
  return instrumentTxCached(id, f.page, f.type, f.year, f.q, f.status);
}

/** Fire every independent loader without awaiting, so they run in parallel. */
export function startInstrumentLoads(id: string, f: InstrumentTxFilters): void {
  // Only what the page does NOT await itself (it awaits instrumentOnce + meOnce directly).
  // Safety invariant for ignoreRejection: every promise fired here has an awaiting section
  // consumer that surfaces a rejection through its own Suspense/error boundary, so the
  // fire-and-forget copy only needs to avoid an unhandled-rejection on a bail-out render.
  // If you remove a section's await of one of these loaders, its failure becomes silent.
  void scopeOnce(id).catch(ignoreRejection);
  void anomaliesOnce().catch(ignoreRejection);
  void incomeStatsOnce().catch(ignoreRejection);
  void instrumentTxOnce(id, f).catch(ignoreRejection);
}

function ignoreRejection(): void {}
