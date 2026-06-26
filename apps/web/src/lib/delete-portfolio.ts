import type { ApiClient } from "@portfolio/api-client";
import { SELECTED_PORTFOLIO_COOKIE } from "@/lib/portfolio-selection";

/**
 * Delete a portfolio and clean up the client-side state both delete entry points share:
 * drop the global switcher selection if it pointed at the now-deleted portfolio, then
 * refresh the RSC so the portfolios list re-fetches. The DB cascade removes the
 * portfolio's transactions/documents/loans/snapshots server-side.
 */
export async function deletePortfolioWithCleanup(
  api: ApiClient,
  router: { refresh: () => void },
  portfolioId: string,
): Promise<void> {
  await api.deletePortfolio(portfolioId);
  if (document.cookie.includes(`${SELECTED_PORTFOLIO_COOKIE}=${portfolioId}`)) {
    document.cookie = `${SELECTED_PORTFOLIO_COOKIE}=all; path=/; max-age=0; samesite=lax`;
  }
  router.refresh();
}
