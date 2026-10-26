import { Decimal } from "decimal.js";
import { expect } from "vitest";
import type { App, Ledger, LedgerTx, LoadedLedger } from "./ledger.js";

// Metamorphic relations: change the input in a known way and the output must change in a known
// way (or not at all). They need no expected values, so they catch what a hand-derived ledger
// can't think of — and each transform is a pure function of a Ledger, which is why scenarios
// are declarative.

/** A derived scenario: its own name (user + instrument namespace) and no fx of its own. */
export function derive(base: Ledger, tag: string, over: Partial<Ledger>): Ledger {
  // `fx_rates` rows are global and the base ledger is loaded first, so the derived scenario
  // reuses them; re-inserting the same pair/date would violate the unique index.
  return { ...base, name: `${base.name}~${tag}`, fx: [], ...over };
}

/** Same rows, reversed insertion order. */
export function reverseOrder(base: Ledger): Ledger {
  return derive(base, "reversed", { transactions: [...base.transactions].reverse() });
}

const isZero = (v: string | undefined) => v === undefined || new Decimal(v).isZero();

/**
 * Multiply every quantity and cash amount by `k`: per-unit prices stay, lump sums (a
 * deposit/withdrawal/interest/dividend without a quantity) and fees/tax scale.
 */
export function scale(base: Ledger, k: number): Ledger {
  const mul = (v: string | undefined) =>
    v === undefined ? undefined : new Decimal(v).mul(k).toString();
  const transactions = base.transactions.map((t): LedgerTx => {
    const lump = isZero(t.quantity);
    return {
      ...t,
      quantity: lump ? t.quantity : mul(t.quantity),
      price: lump ? mul(t.price) : t.price,
      fees: mul(t.fees),
      tax: mul(t.tax),
    };
  });
  return derive(base, `x${k}`, { transactions });
}

/** A same-instant deposit and withdrawal of `amount`: no net effect on anything. */
export function roundtripCash(base: Ledger, portfolio: string, amount: string, at: string): Ledger {
  const currency = base.portfolios[portfolio]!.baseCurrency;
  return derive(base, "roundtrip", {
    transactions: [
      ...base.transactions,
      { portfolio, type: "deposit", price: amount, currency, at },
      { portfolio, type: "withdrawal", price: amount, currency, at },
    ],
  });
}

export interface Outputs {
  networth: Record<string, unknown>;
  perPortfolio: Record<string, Record<string, unknown>>;
}

export async function outputs(app: App, l: LoadedLedger): Promise<Outputs> {
  const get = async (url: string) => {
    const res = await app.inject({ method: "GET", url, headers: l.headers });
    expect(res.statusCode, url).toBe(200);
    return res.json() as Record<string, unknown>;
  };
  const perPortfolio: Outputs["perPortfolio"] = {};
  for (const [key, id] of Object.entries(l.portfolioIds)) {
    perPortfolio[key] = await get(`/portfolios/${id}/summary`);
  }
  return { networth: await get("/networth"), perPortfolio };
}

const MONEY = [
  "netWorth",
  "totalCost",
  "totalMarketValue",
  "totalUnrealizedPnL",
  "totalRealizedPnL",
  "totalIncome",
  "totalLiabilities",
  "totalDayChange",
] as const;
const GAIN = ["value", "costOfOpen", "netContributed", "unrealized", "realized", "income"] as const;

function closeTo(actual: unknown, expected: Decimal, label: string) {
  // Name the field: a renamed or null one would otherwise die as an anonymous DecimalError.
  expect(actual, `${label}: missing`).not.toBeNull();
  expect(actual, `${label}: missing`).not.toBeUndefined();
  const tol = Decimal.max("1e-9", expected.abs().mul("1e-9"));
  const diff = new Decimal(String(actual)).sub(expected).abs();
  expect(diff.lte(tol), `${label}: expected ${expected}, got ${String(actual)}`).toBe(true);
}

const HOLDING_MONEY = ["marketValueDisplay", "unrealizedPnLDisplay", "costBasisDisplay"] as const;

/** The per-holding display figures are what the UI renders: they scale like the totals. */
function compareHoldings(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  k: number,
  label: string,
) {
  type H = Record<string, string | null> & {
    instrumentId: string;
    instrument?: { symbol?: string } | null;
  };
  // A derived scenario has its own instrument rows (symbols are namespaced by ledger name), so
  // holdings are matched on the symbol with that prefix removed, not on the instrument id.
  const key = (h: H) => (h.instrument?.symbol ?? h.instrumentId).split(":").pop()!;
  const ha = (a.holdings as H[] | undefined) ?? [];
  const hb = new Map(((b.holdings as H[] | undefined) ?? []).map((h) => [key(h), h]));
  expect(hb.size, `${label}.holdings count`).toBe(ha.length);
  for (const h of ha) {
    const other = hb.get(key(h));
    expect(other, `${label}.holdings[${key(h)}] missing`).toBeDefined();
    for (const f of HOLDING_MONEY) {
      if (h[f] == null) expect(other![f], `${label}.holdings.${f}`).toBeNull();
      else closeTo(other![f], new Decimal(h[f]!).mul(k), `${label}.holdings.${f}`);
    }
  }
}

function compareBody(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  k: number,
  label: string,
  opts: { skipXirr?: boolean; requireXirr?: boolean } = {},
) {
  for (const f of MONEY) closeTo(b[f], new Decimal(String(a[f])).mul(k), `${label}.${f}`);
  const ga = a.gain as Record<string, string> | undefined;
  const gb = b.gain as Record<string, string> | undefined;
  expect(Boolean(gb), `${label}.gain presence`).toBe(Boolean(ga));
  if (ga && gb) {
    expect(gb.boundary, `${label}.gain.boundary`).toBe(ga.boundary);
    for (const f of GAIN) closeTo(gb[f], new Decimal(ga[f]!).mul(k), `${label}.gain.${f}`);
  }
  expect(b.fxMissingCurrencies, `${label}.fxMissingCurrencies`).toEqual(a.fxMissingCurrencies);
  compareHoldings(a, b, k, label);
  // Rates are scale-free: a ×k ledger earns exactly the same XIRR. Only /networth carries
  // one, and its absence is a failure, not a reason to skip: a renamed key must not turn the
  // "... and the all-time XIRR" check into one that compares nothing.
  if (opts.requireXirr) {
    expect(a, `${label}: xirr missing`).toHaveProperty("xirr");
    expect(b, `${label}: xirr missing`).toHaveProperty("xirr");
    if (!opts.skipXirr) {
      if (a.xirr == null || b.xirr == null) expect(b.xirr, `${label}.xirr`).toBe(a.xirr);
      else expect(b.xirr as number, `${label}.xirr`).toBeCloseTo(a.xirr as number, 9);
    }
  }
}

/**
 * `b` is `a` with every money figure multiplied by `k` (k = 1: identical). Compared at the
 * aggregate and, when both scenarios have the same portfolios, per portfolio.
 */
export function expectScaled(a: Outputs, b: Outputs, k = 1) {
  compareBody(a.networth, b.networth, k, "networth", { requireXirr: true });
  for (const key of Object.keys(a.perPortfolio)) {
    if (!b.perPortfolio[key]) continue;
    compareBody(a.perPortfolio[key]!, b.perPortfolio[key]!, k, `portfolio[${key}]`);
  }
}

/** Only the aggregate (scenarios whose portfolio sets differ, e.g. after moving shares). */
export function expectSameAggregate(a: Outputs, b: Outputs, opts: { skipXirr?: boolean } = {}) {
  compareBody(a.networth, b.networth, 1, "networth", { ...opts, requireXirr: true });
}
