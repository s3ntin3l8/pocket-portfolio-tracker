import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { fxRates } from "@portfolio/db";
import { FX_MAX_CARRY_FORWARD_DAYS, toDateKey, type FxRateFn } from "@portfolio/core";
import type { DB } from "../db/client.js";
import { recordFxMissing } from "../lib/fx-missing.js";
import { chunk } from "../lib/chunk.js";

export { recordFxMissing } from "../lib/fx-missing.js";

/** Live FX source: returns the rate to convert 1 `from` into `to`, or null. */
export interface FxProvider {
  getRate(from: string, to: string): Promise<number | null>;
  /**
   * Optional: daily rates to convert 1 `from` into `to` across [start, end]
   * (inclusive, YYYY-MM-DD), keyed by date. Used to backfill historical FX.
   */
  getRateHistory?(
    from: string,
    to: string,
    start: string,
    end: string,
  ): Promise<Record<string, number>>;
}

/**
 * exchangerate.host-style FX provider: GET <baseUrl>?base=<from>&symbols=<to>
 * → { rates: { <to>: rate } }. Configured via env; absent in tests.
 */
export class HttpFxProvider implements FxProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: typeof fetch = globalThis.fetch,
  ) {}

  async getRate(from: string, to: string): Promise<number | null> {
    try {
      const url = `${this.baseUrl}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
      const res = await this.doFetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[to];
      return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
    } catch {
      return null;
    }
  }
}

/**
 * Frankfurter (api.frankfurter.dev) — a free, key-less FX source backed by ECB
 * reference rates, with current and historical daily series (a whole date range in
 * one request). `GET /rates?base=<from>&quotes=<to>[&from=&to=]` →
 * `[{ date, base, quote, rate }, ...]`.
 */
export class FrankfurterFxProvider implements FxProvider {
  constructor(
    private readonly baseUrl = "https://api.frankfurter.dev/v2",
    private readonly doFetch: typeof fetch = globalThis.fetch,
  ) {}

  async getRate(from: string, to: string): Promise<number | null> {
    try {
      const url = `${this.baseUrl}/rates?base=${encodeURIComponent(from)}&quotes=${encodeURIComponent(to)}`;
      const res = await this.doFetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as { rate?: number }[];
      const rate = data?.[0]?.rate;
      return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
    } catch {
      return null;
    }
  }

  async getRateHistory(
    from: string,
    to: string,
    start: string,
    end: string,
  ): Promise<Record<string, number>> {
    try {
      const url = `${this.baseUrl}/rates?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&base=${encodeURIComponent(from)}&quotes=${encodeURIComponent(to)}`;
      const res = await this.doFetch(url);
      if (!res.ok) return {};
      const data = (await res.json()) as { date?: string; rate?: number }[];
      const out: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.date && typeof row.rate === "number" && Number.isFinite(row.rate)) {
          out[row.date] = row.rate;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
}

let provider: FxProvider | null | undefined;

/**
 * The configured FX provider. A custom `FX_BASE_URL` selects the keyed
 * exchangerate.host-style provider; otherwise we default to the key-less
 * Frankfurter source — except under test, where providers are injected explicitly
 * so the suite stays hermetic (no live network calls). `FX_PROVIDER=none` disables live
 * lookups outright (the demo instance, whose seeded rates must never be overwritten).
 */
export function getFxProvider(): FxProvider | null {
  if (provider === undefined) {
    if (process.env.FX_PROVIDER === "none") {
      provider = null;
    } else if (process.env.FX_BASE_URL) {
      provider = new HttpFxProvider(process.env.FX_BASE_URL);
    } else if (process.env.NODE_ENV === "test") {
      provider = null;
    } else {
      provider = new FrankfurterFxProvider();
    }
  }
  return provider;
}

/** Stringify an FX rate without scientific notation (tiny rates → safe `numeric`). */
function fmtRate(rate: number): string {
  return new Decimal(rate).toFixed();
}

/** Cache one `(from → base, date)` rate, overwriting any existing row for that day. */
async function cacheFxRate(
  db: DB,
  from: string,
  base: string,
  rate: string,
  date: string,
): Promise<void> {
  await db
    .insert(fxRates)
    .values({ base: from, quote: base, rate, date })
    .onConflictDoUpdate({
      target: [fxRates.base, fxRates.quote, fxRates.date],
      set: { rate },
    });
}

/** Cache many `(from → base, date)` rates with chunked multi-row upserts. */
async function cacheFxRates(
  db: DB,
  from: string,
  base: string,
  rates: { date: string; rate: string }[],
): Promise<void> {
  for (const part of chunk(rates)) {
    await db
      .insert(fxRates)
      .values(part.map((r) => ({ base: from, quote: base, rate: r.rate, date: r.date })))
      .onConflictDoUpdate({
        target: [fxRates.base, fxRates.quote, fxRates.date],
        set: { rate: sql`excluded.rate` },
      });
  }
}

/**
 * Negative lookups for the current UTC day (audit D3): `from|base|missingMin|missingMax`
 * ranges the provider was already asked for and still could not fill (outage, currency
 * the ECB does not publish). Without it every history/insights/backfill call re-fetched
 * the same unfillable range. In-process and day-scoped by design — a restart or the next
 * day retries.
 */
const negativeLookups = new Map<string, string>();

/** Test hook: forget remembered negative lookups. */
export function clearFxNegativeCache(): void {
  negativeLookups.clear();
}

/** Shift a YYYY-MM-DD key by whole days (UTC). */
function shiftDateKey(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
}

/**
 * Read-through FX cache: returns each foreign currency's rate to `base`, served
 * from today's fx_rates rows and back-filled live via the provider. A currency the
 * provider can't serve right now (outage, holiday morning before the ECB fix) falls
 * back to its most recent cached rate on or before today, within
 * `FX_MAX_CARRY_FORWARD_DAYS` (audit B2). Currencies with no rate in that window are
 * omitted; {@link makeFxRateFn} then reports them as missing (null), never as 1:1.
 */
export async function getFxRates(
  db: DB,
  currencies: string[],
  base: string,
  now: Date = new Date(),
  fxProvider: FxProvider | null = getFxProvider(),
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const foreign = [...new Set(currencies)].filter((c) => c && c !== base);
  if (foreign.length === 0) return out;

  const today = toDateKey(now);
  const cached = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.quote, base), eq(fxRates.date, today), inArray(fxRates.base, foreign)));
  for (const r of cached) out[r.base] = r.rate;

  const missing = foreign.filter((c) => !(c in out));
  if (missing.length > 0 && fxProvider) {
    for (const from of missing) {
      const rate = await fxProvider.getRate(from, base);
      if (rate === null) continue;
      const str = fmtRate(rate);
      out[from] = str;
      await cacheFxRate(db, from, base, str, today);
    }
  }

  // Carry forward: the latest cached rate on or before today for anything still missing —
  // bounded to FX_MAX_CARRY_FORWARD_DAYS, so an old rate is reported missing (excluded,
  // `fxMissingCurrencies`) rather than presented as today's.
  const stillMissing = foreign.filter((c) => !(c in out));
  if (stillMissing.length > 0) {
    const oldest = new Date(`${today}T00:00:00.000Z`);
    oldest.setUTCDate(oldest.getUTCDate() - FX_MAX_CARRY_FORWARD_DAYS);
    const prior = await db
      .select()
      .from(fxRates)
      .where(
        and(
          eq(fxRates.quote, base),
          lte(fxRates.date, today),
          gte(fxRates.date, toDateKey(oldest)),
          inArray(fxRates.base, stillMissing),
        ),
      )
      .orderBy(desc(fxRates.date));
    // Newest first, first row per base wins. Deterministic: `fx_rates` has a unique
    // index on (base, quote, date), so there is exactly one row per base and date.
    for (const r of prior) {
      if (!(r.base in out)) out[r.base] = r.rate;
    }
  }
  return out;
}

/**
 * Per-day foreign→`base` rates for a set of snapshot `dates`, so historical net-worth
 * converts each day at that day's rate (not today's). Served from `fx_rates`, with any
 * still-missing dates back-filled from the provider's historical series across the
 * range, then carried forward (and back, for leading gaps) to cover non-trading days.
 * Returns a `date → { foreign: rate }` map; currencies with no rate at all are omitted,
 * and {@link makeFxRateFn} reports them as missing (null) rather than 1:1.
 */
export async function getFxRatesForDates(
  db: DB,
  currencies: string[],
  base: string,
  dates: string[],
  fxProvider: FxProvider | null = getFxProvider(),
): Promise<Map<string, Record<string, string>>> {
  const wanted = [...new Set(dates)].sort();
  const result = new Map<string, Record<string, string>>(wanted.map((d) => [d, {}]));
  const foreign = [...new Set(currencies)].filter((c) => c && c !== base);
  if (foreign.length === 0 || wanted.length === 0) return result;

  const maxDate = wanted[wanted.length - 1];
  // `byCurrency[from]` = its known dated rates (cached rows + any back-filled ones),
  // including dates earlier than `wanted` so carry-forward has something to start from.
  const byCurrency = new Map<string, Map<string, string>>(
    foreign.map((c) => [c, new Map<string, string>()]),
  );
  const cached = await db
    .select()
    .from(fxRates)
    .where(
      and(eq(fxRates.quote, base), lte(fxRates.date, maxDate), inArray(fxRates.base, foreign)),
    );
  for (const r of cached) byCurrency.get(r.base)?.set(r.date, r.rate);

  // Back-fill dates that carry-forward cannot already satisfy. A wanted date is satisfied
  // when a cached row exists within FX_MAX_CARRY_FORWARD_DAYS on or before it — ECB
  // (Frankfurter) publishes no weekend/holiday rows, so "no row for this exact date" must
  // not count as missing (audit D3), or every call refetches and re-upserts the range.
  if (fxProvider?.getRateHistory) {
    const today = toDateKey(new Date());
    const unsatisfied = (known: Map<string, string>): string[] => {
      const knownDates = [...known.keys()].sort();
      let i = 0;
      let lastKnown: string | undefined;
      const out: string[] = [];
      for (const d of wanted) {
        while (i < knownDates.length && knownDates[i]! <= d) lastKnown = knownDates[i++];
        if (!lastKnown || lastKnown < shiftDateKey(d, -FX_MAX_CARRY_FORWARD_DAYS)) out.push(d);
      }
      return out;
    };
    await Promise.all(
      foreign.map(async (from) => {
        const known = byCurrency.get(from)!;
        const gaps = unsatisfied(known);
        if (gaps.length === 0) return;
        const lo = gaps[0]!;
        const hi = gaps[gaps.length - 1]!;
        const key = `${from}|${base}|${lo}|${hi}`;
        if (negativeLookups.get(key) === today) return;
        const history = await fxProvider.getRateHistory!(from, base, lo, hi);
        const rows: { date: string; rate: string }[] = [];
        for (const [date, rate] of Object.entries(history)) {
          const str = fmtRate(rate);
          known.set(date, str);
          rows.push({ date, rate: str });
        }
        await cacheFxRates(db, from, base, rows);
        // Still unfillable after a real fetch -> don't ask again today.
        if (unsatisfied(known).length > 0) negativeLookups.set(key, today);
      }),
    );
  }

  for (const from of foreign) {
    const known = byCurrency.get(from)!;
    const knownDates = [...known.keys()].sort();
    if (knownDates.length === 0) continue;
    // Most recent rate on or before each wanted date (carry-forward); for dates before
    // the earliest known rate, carry the earliest one back.
    const earliest = known.get(knownDates[0])!;
    let i = 0;
    let last: string | undefined;
    for (const d of wanted) {
      while (i < knownDates.length && knownDates[i] <= d) {
        last = known.get(knownDates[i]);
        i++;
      }
      result.get(d)![from] = last ?? earliest;
    }
  }
  return result;
}

/**
 * Build a synchronous FxRateFn from a foreign→base rate map (for valuation). An
 * unknown pair returns `null` (audit B2) — never "1", which used to silently count
 * e.g. an IDR amount as EUR — and records the `from` currency into the request's
 * missing-FX scope. Callers exclude what they can't convert (`fxAvailable`/
 * `tryConvert`/`partitionConvertible`) and the response reports `fxMissingCurrencies`;
 * a bare `convert()` throws `FxRateMissingError` as a last resort.
 */
export function makeFxRateFn(rates: Record<string, string>, base: string): FxRateFn {
  return (from, to) => {
    if (from === to) return "1";
    if (to === base && rates[from]) return rates[from];
    recordFxMissing([from]);
    return null;
  };
}
