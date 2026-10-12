import {
  getServerApi,
  getSelectedPortfolioId,
  loadHoldings,
  toApiRange,
  type InstrumentPriceRange,
  type InstrumentDetail,
  type InstrumentScope,
} from "./_shared";
import { classifyFailure, type DataFailure } from "@/lib/data-status";

export type InstrumentResult =
  { status: "ok"; data: InstrumentDetail } | { status: "not_found" } | DataFailure;

/**
 * Loads an instrument and tells "doesn't exist" (404/400/422) apart from a transient
 * failure (rate limit, expired session, API down) — the page must only say "not found"
 * for the former.
 */
export async function loadInstrumentResult(
  id: string,
  range: InstrumentPriceRange = "1y",
): Promise<InstrumentResult> {
  const api = await getServerApi();
  if (!api) return { status: "unauthorized" };
  try {
    const [instrument, history, corporateActions] = await Promise.all([
      api.getInstrument(id),
      api.getInstrumentHistory(id, toApiRange(range)),
      api.listCorporateActions(id),
    ]);
    return { status: "ok", data: { instrument, history, corporateActions } };
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 404 || status === 400 || status === 422) return { status: "not_found" };
    return classifyFailure(err);
  }
}

export async function loadInstrument(
  id: string,
  range: InstrumentPriceRange = "1y",
): Promise<InstrumentDetail | null> {
  const result = await loadInstrumentResult(id, range);
  return result.status === "ok" ? result.data : null;
}

export async function loadInstrumentScope(
  instrumentId: string,
  costBasis?: "purchase_price" | "total_paid",
): Promise<InstrumentScope> {
  const holdingsView = await loadHoldings(costBasis);
  const holding =
    holdingsView.status === "ok"
      ? (holdingsView.holdings.find((h) => h.instrumentId === instrumentId) ?? null)
      : null;

  const aggregate = (await getSelectedPortfolioId()) === null;

  const totalMarketValueDisplay =
    holdingsView.status === "ok"
      ? holdingsView.holdings.reduce(
          (sum, h) => sum + (h.marketValueDisplay ? Number(h.marketValueDisplay) : 0),
          0,
        )
      : null;

  return {
    holding,
    aggregate,
    displayCurrency: holdingsView.displayCurrency,
    totalMarketValueDisplay,
  };
}
