import { mapPool } from "../../lib/promise-pool.js";
import { PORTFOLIO_VALUATION_CONCURRENCY } from "../../routes/transactions/shared/helpers.js";
import type { IntegrityBodies, NetWorthBody, ParityBodies, ValuationBody } from "./rules.js";

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

function needStrings(body: unknown, keys: string[], what: string): Record<string, unknown> {
  const b = body as Record<string, unknown> | null;
  for (const key of keys) {
    if (typeof b?.[key] !== "string") {
      throw new Error(`${what}: expected a string "${key}", got ${JSON.stringify(b?.[key])}`);
    }
  }
  return b!;
}

/** The parity endpoints for one scope: `base` is `/networth` or `/portfolios/:id`. */
async function collectParity(
  get: (url: string) => Promise<unknown>,
  base: string,
): Promise<ParityBodies> {
  const contributions = needStrings(
    await get(`${base}/contributions`),
    ["displayCurrency", "netContributed"],
    `${base}/contributions`,
  );
  const trades = needStrings(
    await get(`${base}/trades`),
    ["displayCurrency", "totalRealized"],
    `${base}/trades`,
  );
  const anomalies = (await get(`${base}/anomalies`)) as { anomalies?: unknown };
  if (!Array.isArray(anomalies?.anomalies)) {
    throw new Error(
      `${base}/anomalies: expected an "anomalies" array, got ${JSON.stringify(anomalies)}`,
    );
  }
  return { contributions, trades, anomalies } as unknown as ParityBodies;
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
  // Sequential on purpose: /networth runs its own PORTFOLIO_VALUATION_CONCURRENCY-wide pool, so
  // overlapping it with the summaries below would double the peak against the shared DB pool.
  const networth = asValuation(await get("/networth"), "/networth") as NetWorthBody;
  // Bounded like the API's own per-portfolio fan-out: every sub-request spends the caller's
  // rate-limit budget, so an unbounded burst on a big account would 429 itself.
  const networthParity = await collectParity(get, "/networth");
  const portfolios = await mapPool(
    portfolioList as { id: string }[],
    PORTFOLIO_VALUATION_CONCURRENCY,
    async (p) => ({
      id: p.id,
      summary: asValuation(await get(`/portfolios/${p.id}/summary`), "summary"),
      parity: await collectParity(get, `/portfolios/${p.id}`),
    }),
  );

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
  return { networth, networthParity, portfolios, fxToDisplay };
}
