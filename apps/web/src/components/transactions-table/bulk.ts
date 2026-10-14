/** Ids per bulk request — keeps each body/`IN` list small when "select all matching" picks thousands. */
export const BULK_CHUNK = 500;

export interface SelectionEntry {
  id: string;
  portfolioId: string;
  status?: string;
}

export function groupIdsByPortfolio(entries: Iterable<SelectionEntry>): Map<string, string[]> {
  const byPortfolio = new Map<string, string[]>();
  for (const e of entries) {
    const ids = byPortfolio.get(e.portfolioId) ?? [];
    ids.push(e.id);
    byPortfolio.set(e.portfolioId, ids);
  }
  return byPortfolio;
}

/**
 * Runs `fn` for every portfolio's ids in {@link BULK_CHUNK}-sized slices: portfolios in
 * parallel (as before), chunks of one portfolio sequentially so a big selection doesn't
 * fan out into hundreds of concurrent requests.
 */
export async function runBulkByPortfolio<R>(
  byPortfolio: Map<string, string[]>,
  fn: (portfolioId: string, ids: string[]) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  await Promise.all(
    [...byPortfolio.entries()].map(async ([portfolioId, ids]) => {
      for (let i = 0; i < ids.length; i += BULK_CHUNK) {
        results.push(await fn(portfolioId, ids.slice(i, i + BULK_CHUNK)));
      }
    }),
  );
  return results;
}
