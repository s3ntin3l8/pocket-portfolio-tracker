import type {
  AssetClass,
  Candle,
  DividendEvent,
  InstrumentFundamentals,
  InstrumentProfile,
  InstrumentRef,
  InstrumentSearchResult,
  MarketDataProvider,
  Quote,
} from "./types.js";
import { assetClassFromType, mapExchange } from "./instrument-mapping.js";
import { isIsin, isWkn, MarketDataError } from "./types.js";

const MAX_SEARCH_RESULTS = 10;
/** How long a gap-fill that produced nothing is not retried for the same instrument. */
const FILL_RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_EMPTY_FILL_MEMO = 1000;
/** Max in-flight quote lookups during `getQuotes`. */
const QUOTE_CONCURRENCY = 4;
/** Provider failures tolerated per `getQuotes` run before it is skipped for the rest. */
const PROVIDER_ERROR_BUDGET = 5;
/** A 429 pauses the provider briefly; a 402 (daily quota) until the next UTC midnight. */
const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;
/** How often a `quotaProbe` provider's usage endpoint is read. */
const QUOTA_PROBE_INTERVAL_MS = 60 * 1000;

function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Optional instrumentation, e.g. to count API calls per provider for usage tracking. */
export interface MarketDataServiceOptions {
  /** Fired with the provider name immediately before each provider method invocation. */
  onCall?: (providerName: string) => void;
  /**
   * Fired when a provider method throws an error that the service is about to swallow
   * (e.g. primary Yahoo 429 covered by a Twelve Data fallback). Without this, a primary
   * outage covered by a fallback is invisible — the caller sees only the successful
   * fallback result and never knows the primary was down. The hook is the place to log
   * at warn level and/or increment an operational counter. Issue #749.
   */
  onProviderError?: (providerName: string, method: string, error: unknown) => void;
}

/**
 * Routes quote/history requests to the providers that support the instrument's asset
 * class + market, trying them in registration order until one returns a result. This
 * makes a keyed primary + keyless fallback (e.g. Twelve Data → Yahoo → fixture)
 * resilient: if the primary is rate-limited or 404s, the next supporter is tried.
 */
export class MarketDataService {
  /** Gap-fill attempts that added nothing → when they may be retried (see `fillGaps`). */
  private readonly emptyFills = new Map<string, number>();
  /** Circuit breaker: provider name → epoch ms until which it is not called (quota/429). */
  private readonly blockedUntil = new Map<string, number>();
  private readonly lastProbeAt = new Map<string, number>();

  constructor(
    private readonly providers: MarketDataProvider[],
    private readonly opts: MarketDataServiceOptions = {},
  ) {}

  /** First provider supporting the asset class/market (registration order). */
  providerFor(assetClass: AssetClass, market: string): MarketDataProvider | null {
    return this.providers.find((p) => p.supports(assetClass, market)) ?? null;
  }

  /** All providers supporting the asset class/market, in registration order (minus tripped ones). */
  private providersFor(assetClass: AssetClass, market: string): MarketDataProvider[] {
    return this.providers.filter((p) => p.supports(assetClass, market) && !this.isBlocked(p));
  }

  private isBlocked(provider: MarketDataProvider): boolean {
    const until = this.blockedUntil.get(provider.name);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    this.blockedUntil.delete(provider.name);
    return false;
  }

  /** Providers currently skipped by the circuit breaker, with when they are retried. */
  getBlockedProviders(): { provider: string; until: Date }[] {
    return this.providers
      .filter((p) => this.isBlocked(p))
      .map((p) => ({ provider: p.name, until: new Date(this.blockedUntil.get(p.name)!) }));
  }

  /**
   * Every provider failure goes through here: a quota signal (HTTP 402 daily limit, 429
   * rate limit) trips the breaker so the provider isn't asked again — each wasted call
   * burns the budget it just ran out of — then the usual `onProviderError` fires.
   */
  private providerFailed(provider: MarketDataProvider, method: string, err: unknown): void {
    if (err instanceof MarketDataError && (err.status === 402 || err.status === 429)) {
      const now = Date.now();
      const until = err.status === 402 ? nextUtcMidnight(now) : now + RATE_LIMIT_COOLDOWN_MS;
      if (!this.isBlocked(provider)) this.blockedUntil.set(provider.name, until);
    }
    this.opts.onProviderError?.(provider.name, method, err);
  }

  /**
   * For providers whose usage endpoint is free and reports a hard daily cap (`quotaProbe`),
   * stop calling them once `used >= limit` — before paying for the 402 — and resume as soon
   * as the endpoint reports headroom again (e.g. purchased extra calls). Read at most once a
   * minute per provider; a failed or unparseable probe never blocks (fail open — the
   * reactive 402 trigger in `providerFailed` is the backstop).
   */
  private async probeQuotas(): Promise<void> {
    const now = Date.now();
    await Promise.all(
      this.providers.map(async (provider) => {
        if (!provider.quotaProbe || !provider.getUsage) return;
        if (now - (this.lastProbeAt.get(provider.name) ?? 0) < QUOTA_PROBE_INTERVAL_MS) return;
        this.lastProbeAt.set(provider.name, now);
        try {
          const usage = await provider.getUsage();
          if (usage?.window !== "day" || usage.used == null || usage.limit == null) return;
          if (usage.used >= usage.limit) {
            if (!this.isBlocked(provider)) {
              this.blockedUntil.set(provider.name, nextUtcMidnight(now));
              this.opts.onProviderError?.(
                provider.name,
                "quota",
                new MarketDataError(
                  `daily quota exhausted (${usage.used}/${usage.limit})`,
                  provider.name,
                  402,
                ),
              );
            }
          } else {
            this.blockedUntil.delete(provider.name);
          }
        } catch {
          // fail open
        }
      }),
    );
  }

  async getQuote(ref: InstrumentRef): Promise<Quote | null> {
    await this.probeQuotas();
    return this.getQuoteBudgeted(ref);
  }

  /**
   * `budget` (optional, shared across one `getQuotes` run) counts provider failures; a
   * provider that has already failed `PROVIDER_ERROR_BUDGET` times in the run is skipped
   * for the remaining instruments so one dead upstream can't stall a 5-minute refresh.
   */
  private async getQuoteBudgeted(
    ref: InstrumentRef,
    budget?: Map<string, number>,
  ): Promise<Quote | null> {
    for (const provider of this.providersFor(ref.assetClass, ref.market)) {
      if ((budget?.get(provider.name) ?? 0) >= PROVIDER_ERROR_BUDGET) continue;
      try {
        this.opts.onCall?.(provider.name);
        const quote = await provider.getQuote(ref);
        if (quote) return quote;
      } catch (err) {
        budget?.set(provider.name, (budget.get(provider.name) ?? 0) + 1);
        // Surfaced even when a later provider succeeds (#749, audit D10).
        this.providerFailed(provider, "getQuote", err);
        // A failing/timing-out provider shouldn't block the fallback chain — try the next.
      }
    }
    return null;
  }

  async getHistory(ref: InstrumentRef, range: string): Promise<Candle[]> {
    await this.probeQuotas();
    let lastError: unknown;
    for (const provider of this.providersFor(ref.assetClass, ref.market)) {
      if (!provider.getHistory) continue;
      try {
        this.opts.onCall?.(provider.name);
        const candles = (await provider.getHistory(ref, range)) ?? [];
        if (candles.length > 0) return candles;
      } catch (err) {
        lastError = err;
        // The error is surfaced via onProviderError even when a later provider succeeds —
        // a primary Yahoo outage covered by a fallback is operationally important and
        // shouldn't be invisible (#749).
        this.providerFailed(provider, "getHistory", err);
        // A failing/timing-out provider shouldn't block the fallback chain — try the next.
      }
    }
    if (lastError) throw lastError;
    return [];
  }

  /**
   * `allowMaxFallback` (default `true`) controls the "no provider returned candles for
   * this window" fallback below. A caller doing a tail-only heal (only the gap since a
   * known-good date is missing; see issue #737) wants `false` — an empty window there
   * means "no new candles since then", not "this instrument has no history at all", and
   * falling back to a full-range `getHistory(ref, "max")` call on every such miss is what
   * let a permanently dead feed re-trigger an unbounded provider fetch every sweep run.
   */
  async getHistoryFrom(
    ref: InstrumentRef,
    fromDate: string,
    opts: { allowMaxFallback?: boolean; gapFillDays?: number } = {},
  ): Promise<Candle[]> {
    await this.probeQuotas();
    let lastError: unknown;
    const providers = this.providersFor(ref.assetClass, ref.market);
    for (const [i, provider] of providers.entries()) {
      if (!provider.getHistoryFrom) continue;
      try {
        this.opts.onCall?.(provider.name);
        const candles = (await provider.getHistoryFrom(ref, fromDate)) ?? [];
        if (candles.length > 0) {
          return opts.gapFillDays === undefined
            ? candles
            : this.fillGaps(ref, candles, providers.slice(i + 1), opts.gapFillDays, fromDate);
        }
      } catch (err) {
        lastError = err;
        this.providerFailed(provider, "getHistoryFrom", err);
        // A failing/timing-out provider shouldn't block the fallback chain — try the next.
      }
    }
    // A tail-only heal (allowMaxFallback: false) treats any all-failed/all-empty
    // scenario as "nothing new" — but if a provider actually threw, surface that to
    // the backfill layer so it can count it as an error (issue #749).
    if (lastError && opts.allowMaxFallback === false) throw lastError;
    if (opts.allowMaxFallback === false) return [];
    // Fallback: try getHistory with max range if no provider supports getHistoryFrom
    return this.getHistory(ref, "max");
  }

  /**
   * The first provider with candles wins `getHistoryFrom`, so a hole in its series (a
   * feed that silently skipped weeks) is never patched by the providers behind it. Ask the
   * remaining providers for the holes longer than `minGapDays` and merge by date: the
   * primary's candles always win on overlap. The fallback is asked in the primary's own
   * quote currency (a USD-priced line declared EUR stays USD) and a candle in any other
   * currency is dropped, so the merged series is single-currency — consumers that read
   * `close` alone (sparklines) never see an FX-sized seam. A failing fallback is skipped and
   * reported through `onProviderError`; a fill that produced nothing is remembered for
   * `FILL_RETRY_MS` so a stale-but-alive feed isn't re-scraped on every call.
   *
   * A series that starts more than `minGapDays` after the requested `fromDate` has a
   * leading hole too — a feed that only keeps recent history (or lost the older part of a
   * line) would otherwise leave everything before its first candle unpriced, and the
   * stored rows there never refreshed. The fallback is asked for it like any interior hole;
   * an instrument that genuinely listed later simply yields nothing (memoized as an empty
   * fill).
   */
  private async fillGaps(
    ref: InstrumentRef,
    primary: Candle[],
    fallbacks: MarketDataProvider[],
    minGapDays: number,
    fromDate: string,
  ): Promise<Candle[]> {
    const merged = new Map(primary.map((c) => [c.date, c]));
    const today = new Date().toISOString().slice(0, 10);
    const currency = primary.find((c) => c.currency)?.currency ?? ref.currency;
    const fillRef = { ...ref, currency };
    for (const provider of fallbacks) {
      if (!provider.getHistoryFrom) continue;
      const gaps = findGaps([...merged.keys()], today, minGapDays, fromDate);
      if (gaps.length === 0) break;
      const memoKey = `${provider.name}|${ref.market}|${ref.symbol}|${gaps[0]!.from}|${currency}`;
      if ((this.emptyFills.get(memoKey) ?? 0) > Date.now()) continue;
      let added = 0;
      try {
        this.opts.onCall?.(provider.name);
        const extra = (await provider.getHistoryFrom(fillRef, gaps[0]!.from)) ?? [];
        for (const c of extra) {
          if (merged.has(c.date) || (c.currency ?? currency) !== currency) continue;
          if (gaps.some((g) => c.date >= g.from && c.date <= g.to)) {
            merged.set(c.date, { ...c, currency });
            added++;
          }
        }
      } catch (err) {
        this.providerFailed(provider, "getHistoryFrom", err);
        // A blocked/429 fallback is the normal failure shape of a scraped endpoint: back
        // off like an empty fill instead of re-asking on every call.
        added = 0;
      }
      if (added === 0) {
        if (this.emptyFills.size >= MAX_EMPTY_FILL_MEMO) this.emptyFills.clear();
        this.emptyFills.set(memoKey, Date.now() + FILL_RETRY_MS);
      }
    }
    return [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async getDividends(ref: InstrumentRef, fromDate?: string): Promise<DividendEvent[]> {
    await this.probeQuotas();
    for (const provider of this.providersFor(ref.assetClass, ref.market)) {
      if (!provider.getDividends) continue;
      try {
        this.opts.onCall?.(provider.name);
        const events = (await provider.getDividends(ref, fromDate)) ?? [];
        if (events.length > 0) return events;
      } catch (err) {
        // One provider throwing must not abort the chain (audit D10).
        this.providerFailed(provider, "getDividends", err);
      }
    }
    return [];
  }

  /**
   * Fetch instrument profile metadata (sector, industry, country). Calls ALL
   * supporting providers and merges their results — different providers return
   * different fields (e.g. EODHD returns sectorWeights, JustETF returns
   * countryWeights), so merging gives a complete picture.
   */
  async getProfile(ref: InstrumentRef): Promise<InstrumentProfile | null> {
    await this.probeQuotas();
    const parts: InstrumentProfile[] = [];
    for (const provider of this.providersFor(ref.assetClass, ref.market)) {
      if (!provider.getProfile) continue;
      try {
        this.opts.onCall?.(provider.name);
        const profile = await provider.getProfile(ref);
        if (profile != null) parts.push(profile);
      } catch (err) {
        // A failing provider shouldn't block the others (a quota error trips the breaker).
        this.providerFailed(provider, "getProfile", err);
      }
    }
    if (parts.length === 0) return null;
    return Object.assign({}, ...parts);
  }

  /**
   * Fetch fundamental/valuation data (market cap, PE, EPS, dividend yield, analyst
   * recommendations, revenue-vs-earnings, next earnings date) for the instrument detail
   * view. Unlike `getProfile`, this is first-match-wins (not merged) — the returned
   * `currency` labels every monetary field, and merging across providers would risk
   * mixing currencies. Only Yahoo implements it today; kept as a loop for future providers.
   */
  async getFundamentals(ref: InstrumentRef): Promise<InstrumentFundamentals | null> {
    for (const provider of this.providersFor(ref.assetClass, ref.market)) {
      if (!provider.getFundamentals) continue;
      try {
        this.opts.onCall?.(provider.name);
        const fundamentals = await provider.getFundamentals(ref);
        if (fundamentals) return fundamentals;
      } catch {
        // A failing provider shouldn't block the fallback chain — try the next.
      }
    }
    return null;
  }

  /**
   * Discover instruments by free-text ticker/name, or resolve a 12-char ISIN. Fans out
   * across **all** providers that can search/resolve (search is not `supports`-gated),
   * merges the results, and dedupes by ISIN (else `market:symbol`) keeping the first
   * provider in registration order — so a keyed primary's richer metadata wins over a
   * keyless fallback's. A failing provider is skipped, never fatal.
   */
  async search(query: string): Promise<InstrumentSearchResult[]> {
    await this.probeQuotas();
    const q = query.trim();
    if (!q) return [];

    const collected: InstrumentSearchResult[] = [];
    // Track whether a WKN query resolved anything, so we can fall through to name search.
    let wknResolved = false;
    for (const provider of this.providers) {
      if (this.isBlocked(provider)) continue;
      try {
        if (isIsin(q)) {
          if (!provider.resolveISIN) continue;
          this.opts.onCall?.(provider.name);
          const resolved = await provider.resolveISIN(q);
          if (resolved) {
            collected.push(this.fromResolvedIsin(provider, q, resolved));
          }
        } else if (isWkn(q) && provider.resolveWKN) {
          this.opts.onCall?.(provider.name);
          const resolved = await provider.resolveWKN(q);
          if (resolved) {
            collected.push(this.fromResolvedWkn(provider, q, resolved));
            wknResolved = true;
          }
        } else if (!isWkn(q) || !wknResolved) {
          // Fall through to name/ticker search for non-WKN queries, or for alphanumeric
          // queries that looked like WKNs but resolved nothing (leniency).
          if (!provider.search) continue;
          this.opts.onCall?.(provider.name);
          const results = (await provider.search(q)) ?? [];
          collected.push(...results);
        }
      } catch (err) {
        // A provider that errors or times out shouldn't sink the whole lookup.
        this.providerFailed(provider, "search", err);
      }
    }

    return this.dedupe(collected).slice(0, MAX_SEARCH_RESULTS);
  }

  /** Turn a bare ISIN resolution (symbol + exchange) into a full search result. */
  private fromResolvedIsin(
    provider: MarketDataProvider,
    isin: string,
    resolved: { symbol: string; exchange: string; name?: string; type?: string },
  ): InstrumentSearchResult {
    const info = mapExchange(resolved.exchange);
    return {
      symbol: resolved.symbol,
      name: resolved.name ?? resolved.symbol,
      market: info?.market ?? resolved.exchange,
      assetClass: assetClassFromType(resolved.type, {
        symbol: resolved.symbol,
        market: info?.market,
      }),
      currency: info?.currency ?? "USD",
      isin,
      source: provider.name,
    };
  }

  /** Turn a bare WKN resolution (symbol + exchange) into a full search result. */
  private fromResolvedWkn(
    provider: MarketDataProvider,
    wkn: string,
    resolved: { symbol: string; exchange: string; name?: string; type?: string },
  ): InstrumentSearchResult {
    const info = mapExchange(resolved.exchange);
    return {
      symbol: resolved.symbol,
      name: resolved.name ?? resolved.symbol,
      market: info?.market ?? resolved.exchange,
      assetClass: assetClassFromType(resolved.type, {
        symbol: resolved.symbol,
        market: info?.market,
      }),
      currency: info?.currency ?? "USD",
      wkn,
      source: provider.name,
    };
  }

  private dedupe(results: InstrumentSearchResult[]): InstrumentSearchResult[] {
    const seen = new Set<string>();
    const out: InstrumentSearchResult[] = [];
    for (const r of results) {
      const key = r.isin ? `isin:${r.isin}` : `${r.market}:${r.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  /**
   * Resolve a clean human-readable name for a query (ISIN, ticker, or free text).
   * Fans out across all providers that implement resolveName, returning the first
   * non-null result (registration order). Unlike search(), this is a lightweight
   * cosmetic lookup — no market/currency gating.
   */
  async resolveName(query: string): Promise<string | null> {
    await this.probeQuotas();
    const q = query.trim();
    if (!q) return null;
    for (const provider of this.providers) {
      if (!provider.resolveName || this.isBlocked(provider)) continue;
      try {
        this.opts.onCall?.(provider.name);
        const name = await provider.resolveName(q);
        if (name) return name;
      } catch {
        // A failing provider shouldn't block the fan-out.
      }
    }
    return null;
  }

  /**
   * Quote several instruments, keyed by an id you supply (e.g. instrument id). Runs with
   * bounded concurrency (not an unbounded `Promise.all`) and a per-run error budget per
   * provider (audit D2).
   */
  async getQuotes(refs: Array<{ id: string; ref: InstrumentRef }>): Promise<Record<string, Quote>> {
    await this.probeQuotas();
    const out: Record<string, Quote> = {};
    const budget = new Map<string, number>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < refs.length) {
        const { id, ref } = refs[next++]!;
        const quote = await this.getQuoteBudgeted(ref, budget);
        if (quote) out[id] = quote;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(QUOTE_CONCURRENCY, refs.length) }, () => worker()),
    );
    return out;
  }
}

const DAY_MS = 86_400_000;

function dayDiff(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Inclusive date windows with no candle, for every stretch between consecutive candle
 * dates (and from the last candle to `today`) longer than `minGapDays`. The window before
 * the first candle is not a gap — that is the instrument not existing yet — unless the
 * caller passes `from` (the start it asked for): then the stretch from `from` to the first
 * candle is a gap too, with `from` itself included.
 */
export function findGaps(
  dates: string[],
  today: string,
  minGapDays: number,
  from?: string,
): { from: string; to: string }[] {
  const sortedDates = [...new Set(dates)].sort();
  const gaps: { from: string; to: string }[] = [];
  if (from !== undefined && sortedDates.length > 0 && dayDiff(from, sortedDates[0]!) > minGapDays) {
    gaps.push({ from, to: addDays(sortedDates[0]!, -1) });
  }
  for (let i = 1; i <= sortedDates.length; i++) {
    const prev = sortedDates[i - 1]!;
    const next = i < sortedDates.length ? sortedDates[i]! : today;
    if (dayDiff(prev, next) > minGapDays)
      gaps.push({ from: addDays(prev, 1), to: addDays(next, i < sortedDates.length ? -1 : 0) });
  }
  return gaps;
}
