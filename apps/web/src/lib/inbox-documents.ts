import type { InboxDocument } from "@portfolio/api-client";
import type { ScopeSelection } from "@/lib/portfolio-selection";

/** Inbox rows attached to one of `portfolioIds`. A row with no portfolio is in no holder's scope. */
export function documentsForPortfolios(
  docs: InboxDocument[],
  portfolioIds: ReadonlySet<string>,
): InboxDocument[] {
  return docs.filter((d) => d.portfolioId != null && portfolioIds.has(d.portfolioId));
}

/**
 * The portfolios an inbox surface may list and upload into for `scope`.
 *
 * One function so the loader, the picker, and the post-upload refresh can't drift:
 * a holder scope is that holder's portfolios (not `portfolios[0]` of the whole list),
 * a portfolio scope is that portfolio, and anything else is every portfolio.
 * `portfolioIds` is null for the all-portfolios view (no id filter).
 */
export function inboxPortfolios<P extends { id: string; accountHolderId?: string | null }>(
  portfolios: P[],
  scope: ScopeSelection,
): { portfolios: P[]; portfolioIds: string[] | null } {
  if (scope.kind === "portfolio") {
    return {
      portfolios: portfolios.filter((p) => p.id === scope.portfolioId),
      portfolioIds: [scope.portfolioId],
    };
  }
  if (scope.kind === "holder") {
    const owned = portfolios.filter((p) => p.accountHolderId === scope.holderId);
    return { portfolios: owned, portfolioIds: owned.map((p) => p.id) };
  }
  return { portfolios, portfolioIds: null };
}
