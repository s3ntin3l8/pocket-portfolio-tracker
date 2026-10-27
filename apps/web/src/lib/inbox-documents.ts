import type { InboxDocument } from "@portfolio/api-client";

/** Inbox rows attached to one of `portfolioIds`. A row with no portfolio is in no holder's scope. */
export function documentsForPortfolios(
  docs: InboxDocument[],
  portfolioIds: ReadonlySet<string>,
): InboxDocument[] {
  return docs.filter((d) => d.portfolioId != null && portfolioIds.has(d.portfolioId));
}
