import { mapPool } from "../../lib/promise-pool.js";
import { PORTFOLIO_VALUATION_CONCURRENCY } from "../../routes/transactions/shared/helpers.js";
import { allInDisplayCurrency } from "./rules.js";
import type {
  HistoryPoint,
  IntegrityBodies,
  NetWorthBody,
  ParityBodies,
  ValuationBody,
} from "./rules.js";

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
 * Check that `body` carries a string for every key and return it typed by exactly those keys.
 * Building each parity object from this (instead of re-typing with a cast) ties the guard to
 * the interface: a field added to `ParityBodies` without a guard is a type error, not an
 * anonymous DecimalError at the first `new Decimal(...)`.
 */
function needStrings<K extends string>(
  body: unknown,
  keys: readonly K[],
  what: string,
): Record<K, string> {
  const b = body as Record<string, unknown> | null;
  for (const key of keys) {
    if (typeof b?.[key] !== "string") {
      throw new Error(`${what}: expected a string "${key}", got ${JSON.stringify(b?.[key])}`);
    }
  }
  return b as Record<K, string>;
}

/**
 * A history series: an array of points that each carry a date and the two values. No rule reads
 * `marketValue` today (the aggregate's `marketValue` carries a gap leg forward by design, see
 * `checkHistorySumsPortfolios`); it is required on purpose, as an endpoint-contract check, so a
 * renamed or dropped field fails by name instead of a rule silently comparing nothing later.
 */
function asHistory(body: unknown, what: string): HistoryPoint[] {
  if (!Array.isArray(body)) {
    throw new Error(`${what}: expected an array, got ${JSON.stringify(body)}`);
  }
  return body.map((pt, i) => {
    const v = needStrings(pt, ["date", "netWorth", "marketValue"], `${what}[${i}]`);
    return { date: v.date, netWorth: v.netWorth, marketValue: v.marketValue };
  });
}

/** The parity endpoints for one scope: `base` is `/networth` or `/portfolios/:id`. */
async function collectParity(
  get: (url: string) => Promise<unknown>,
  base: string,
): Promise<ParityBodies> {
  const contributionsBody = await get(`${base}/contributions`);
  const tradesBody = await get(`${base}/trades`);
  const anomaliesBody = (await get(`${base}/anomalies`)) as { anomalies?: unknown };
  if (!Array.isArray(anomaliesBody?.anomalies)) {
    throw new Error(
      `${base}/anomalies: expected an "anomalies" array, got ${JSON.stringify(anomaliesBody)}`,
    );
  }
  const contributions = needStrings(
    contributionsBody,
    ["displayCurrency", "netContributed"],
    `${base}/contributions`,
  );
  const trades = needStrings(tradesBody, ["displayCurrency", "totalRealized"], `${base}/trades`);
  const income = needStrings(
    await get(`${base}/income`),
    ["displayCurrency", "lifetimeTotal"],
    `${base}/income`,
  );
  return { contributions, trades, income, anomalies: anomaliesBody as ParityBodies["anomalies"] };
}

/**
 * Fetch the response bodies the rules read. `get` returns the parsed JSON of a GET and throws
 * on a non-200, so a failing endpoint is a loud failure, not an empty (vacuously passing) rule.
 * Tests pass an `app.inject` wrapper; the real-data report passes an in-process inject with the
 * caller's own auth — the same rule code runs against the same serialized responses.
 *
 * Cost: per portfolio this is the summary plus the contributions, trades and anomalies
 * endpoints (and its history series when every portfolio is in the display currency), and the
 * aggregate adds the same three plus `/networth/history`, all drawn from the caller's own
 * rate-limit bucket and valuation work (`/portfolios/:id/contributions` has no derivation
 * cache). On a big account a 429/502 from here is this fan-out, not a data problem.
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

  const networthHistory = asHistory(await get("/networth/history?range=all"), "/networth/history");
  // Summing the per-portfolio series is only exact when no currency conversion is involved.
  const histories = allInDisplayCurrency(to, portfolios)
    ? await mapPool(portfolios, PORTFOLIO_VALUATION_CONCURRENCY, async (p) =>
        asHistory(
          await get(`/portfolios/${p.id}/history?range=all`),
          `/portfolios/${p.id}/history`,
        ),
      )
    : null;
  return {
    networth,
    networthParity,
    networthHistory,
    portfolios: portfolios.map((p, i) => ({ ...p, history: histories ? histories[i]! : null })),
    fxToDisplay,
  };
}
