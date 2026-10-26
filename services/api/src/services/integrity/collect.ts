import type { IntegrityBodies, NetWorthBody, ValuationBody } from "./rules.js";

const REQUIRED_STRINGS = [
  "displayCurrency",
  "netWorth",
  "totalCost",
  "totalMarketValue",
  "totalUnrealizedPnL",
  "totalRealizedPnL",
  "totalIncome",
  "totalLiabilities",
] as const;

/**
 * Response validation is off in production for these routes, so a renamed or dropped field
 * would otherwise surface as a TypeError deep inside a rule. Fail here instead, naming the
 * endpoint and the field, and default the collections the rules iterate.
 */
function asValuation(body: unknown, what: string): ValuationBody {
  const b = body as Record<string, unknown> | null;
  for (const key of REQUIRED_STRINGS) {
    if (typeof b?.[key] !== "string") {
      throw new Error(`${what}: expected a string "${key}", got ${JSON.stringify(b?.[key])}`);
    }
  }
  // A dropped boolean must not read as `false`: `cashTracked` gates whether cash is counted, so
  // a missing field would silently turn "cash is tracked" into "it isn't" — a false pass.
  if (typeof b!.cashTracked !== "boolean") {
    throw new Error(
      `${what}: expected a boolean "cashTracked", got ${JSON.stringify(b!.cashTracked)}`,
    );
  }
  const gain = b!.gain as Record<string, unknown> | undefined;
  if (gain != null) {
    for (const key of [
      "value",
      "costOfOpen",
      "netContributed",
      "unrealized",
      "realized",
      "income",
    ]) {
      if (typeof gain[key] !== "string") {
        throw new Error(
          `${what}: expected a string "gain.${key}", got ${JSON.stringify(gain[key])}`,
        );
      }
    }
  }
  return {
    ...(b as unknown as ValuationBody),
    cashDisplay: (b!.cashDisplay as Record<string, string> | undefined) ?? {},
    holdings: (b!.holdings as ValuationBody["holdings"] | undefined) ?? [],
    fxMissingCurrencies: (b!.fxMissingCurrencies as string[] | undefined) ?? [],
  };
}

/**
 * Fetch the response bodies the rules read. `get` returns the parsed JSON of a GET and throws
 * on a non-200, so a failing endpoint is a loud failure, not an empty (vacuously passing) rule.
 * Tests pass an `app.inject` wrapper; the real-data report passes an in-process inject with the
 * caller's own auth — the same rule code runs against the same serialized responses.
 */
export async function collectBodies(
  get: (url: string) => Promise<unknown>,
): Promise<IntegrityBodies> {
  const portfolioList = await get("/portfolios");
  if (!Array.isArray(portfolioList)) {
    throw new Error(`/portfolios: expected an array, got ${JSON.stringify(portfolioList)}`);
  }
  const [networth, summaries] = await Promise.all([
    get("/networth").then((b) => asValuation(b, "/networth") as NetWorthBody),
    Promise.all(
      portfolioList.map(
        async (p) =>
          [p.id, asValuation(await get(`/portfolios/${p.id}/summary`), "summary")] as const,
      ),
    ),
  ]);
  const portfolios = summaries.map(([id, summary]) => ({ id, summary }));

  // Today's rate (UTC day of the networth response) for every portfolio currency that differs
  // from the display currency — the same cache the valuation reads.
  const to = networth.displayCurrency;
  if (typeof networth.asOf !== "string") {
    throw new Error(`/networth: expected a string "asOf", got ${JSON.stringify(networth.asOf)}`);
  }
  const date = networth.asOf.slice(0, 10);
  const fxToDisplay: Record<string, string | null> = {};
  for (const from of new Set(portfolios.map((p) => p.summary.displayCurrency))) {
    if (from === to) continue;
    const r = (await get(`/fx-rate?from=${from}&to=${to}&date=${date}`)) as { rate: string | null };
    fxToDisplay[from] = r.rate;
  }
  return { networth, portfolios, fxToDisplay };
}
