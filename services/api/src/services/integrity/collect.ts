import type { IntegrityBodies, NetWorthBody, ValuationBody } from "./rules.js";

/**
 * Fetch the response bodies the rules read. `get` returns the parsed JSON of a GET and throws
 * on a non-200, so a failing endpoint is a loud failure, not an empty (vacuously passing) rule.
 * Tests pass an `app.inject` wrapper; the real-data report passes an in-process inject with the
 * caller's own auth — the same rule code runs against the same serialized responses.
 */
export async function collectBodies(
  get: (url: string) => Promise<unknown>,
): Promise<IntegrityBodies> {
  const portfolioList = (await get("/portfolios")) as { id: string }[];
  const [networth, history, summaries] = await Promise.all([
    get("/networth") as Promise<NetWorthBody>,
    get("/networth/history?range=all") as Promise<{ netWorth: string }[]>,
    Promise.all(
      portfolioList.map(
        async (p) => [p.id, (await get(`/portfolios/${p.id}/summary`)) as ValuationBody] as const,
      ),
    ),
  ]);
  const portfolios = summaries.map(([id, summary]) => ({ id, summary }));

  // Today's rate (UTC day of the networth response) for every portfolio currency that differs
  // from the display currency — the same cache the valuation reads.
  const to = networth.displayCurrency;
  const date = networth.asOf.slice(0, 10);
  const fxToDisplay: Record<string, string | null> = {};
  for (const from of new Set(portfolios.map((p) => p.summary.displayCurrency))) {
    if (from === to) continue;
    const r = (await get(`/fx-rate?from=${from}&to=${to}&date=${date}`)) as { rate: string | null };
    fxToDisplay[from] = r.rate;
  }
  return { networth, history, portfolios, fxToDisplay };
}
