import type {
  AssetClass,
  DividendEvent,
  InstrumentProfile,
  InstrumentRef,
  MarketDataProvider,
  ProviderUsage,
  Quote,
} from "./types.js";
import { isIsin } from "./types.js";
import { eodhdExchangeForMarket, mapExchange } from "./instrument-mapping.js";

export interface EodhdOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface EodhdSearchHit {
  Code?: string;
  Exchange?: string;
  Currency?: string;
  ISIN?: string;
}

/**
 * EODHD (eodhd.com) — a **keyed** provider for the EU/Xetra equities & ETFs the IDX-only
 * Twelve Data and keyless Yahoo paths can't reliably price. Quotes the real-time endpoint
 * (`/api/real-time/<code>.<exchange>`). When the instrument's symbol is an ISIN (or the
 * direct ticker misses), the search endpoint resolves the ISIN to a `<code>.<exchange>`
 * ticker, preferring the listing matching the instrument's market/currency. The resolved
 * ticker is memoised per ISIN.
 */
export class EodhdProvider implements MarketDataProvider {
  readonly name = "eodhd";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly isinTickerCache = new Map<string, string | null>();

  constructor(opts: EodhdOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://eodhd.com/api";
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  supports(assetClass: AssetClass, market: string): boolean {
    if (assetClass !== "equity" && assetClass !== "etf") return false;
    return eodhdExchangeForMarket(market) !== undefined;
  }

  /** Build the `<code>.<exchange>` ticker, or null if the symbol can't be qualified. */
  private directTicker(ref: InstrumentRef): string | null {
    if (ref.symbol.includes(".")) return ref.symbol;
    if (isIsin(ref.symbol)) return null;
    const exchange = eodhdExchangeForMarket(ref.market);
    return exchange ? `${ref.symbol}.${exchange}` : null;
  }

  /** Resolve an ISIN to an EODHD ticker, preferring the market/currency match. */
  private async resolveIsinTicker(ref: InstrumentRef): Promise<string | null> {
    if (!ref.isin) return null;
    const cached = this.isinTickerCache.get(ref.isin);
    if (cached !== undefined) return cached;

    const res = await this.doFetch(
      `${this.baseUrl}/search/${encodeURIComponent(ref.isin)}?api_token=${this.apiKey}&fmt=json`,
    );
    let ticker: string | null = null;
    if (res.ok) {
      const hits = (await res.json()) as EodhdSearchHit[];
      const usable = (hits ?? []).filter((h) => h.Code && h.Exchange);
      const exchange = eodhdExchangeForMarket(ref.market);
      const byMarket = exchange
        ? usable.find((h) => h.Exchange === exchange)
        : undefined;
      const byCurrency = usable.find(
        (h) =>
          h.Currency === ref.currency ||
          mapExchange(h.Exchange)?.currency === ref.currency,
      );
      const hit = byMarket ?? byCurrency ?? usable[0];
      ticker = hit ? `${hit.Code}.${hit.Exchange}` : null;
    }
    this.isinTickerCache.set(ref.isin, ticker);
    return ticker;
  }

  async getUsage(): Promise<ProviderUsage | null> {
    // The `/user` endpoint reports the day's request count + the daily cap (resets
    // midnight GMT). `extraLimit` is purchased headroom on top of the plan limit.
    try {
      const res = await this.doFetch(
        `${this.baseUrl}/user?api_token=${this.apiKey}&fmt=json`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        apiRequests?: number;
        dailyRateLimit?: number;
        extraLimit?: number;
      };
      if (data.apiRequests === undefined && data.dailyRateLimit === undefined) {
        return null;
      }
      const limit =
        data.dailyRateLimit !== undefined
          ? data.dailyRateLimit + (data.extraLimit ?? 0)
          : null;
      return { window: "day", used: data.apiRequests ?? null, limit };
    } catch {
      return null;
    }
  }

  async getDividends(ref: InstrumentRef, fromDate?: string): Promise<DividendEvent[]> {
    const ticker = this.directTicker(ref) ?? (await this.resolveIsinTicker(ref));
    if (!ticker) return [];
    const from =
      fromDate ??
      new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await this.doFetch(
      `${this.baseUrl}/div/${encodeURIComponent(ticker)}?api_token=${this.apiKey}&fmt=json&from=${from}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as
      | { date?: string; paymentDate?: string; unadjustedValue?: number | string; value?: number | string; currency?: string }[]
      | null;
    if (!Array.isArray(data)) return [];
    return data
      .filter((d) => d.date && (d.unadjustedValue ?? d.value) != null)
      .map((d) => ({
        exDate: d.date as string,
        payDate: d.paymentDate ?? null,
        // Prefer unadjustedValue (pre-split) so stored amounts stay stable.
        amountPerShare: String(d.unadjustedValue ?? d.value),
        currency: d.currency ?? ref.currency,
      }));
  }

  async getQuote(ref: InstrumentRef): Promise<Quote | null> {
    const ticker = this.directTicker(ref) ?? (await this.resolveIsinTicker(ref));
    if (!ticker) return null;

    const res = await this.doFetch(
      `${this.baseUrl}/real-time/${encodeURIComponent(ticker)}?api_token=${this.apiKey}&fmt=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      close?: number | string;
      previousClose?: number | string;
      timestamp?: number;
    };
    // EODHD returns "NA" (or omits the field) when there's no quote for the ticker.
    if (data.close === undefined || data.close === "NA") return null;

    return {
      price: String(data.close),
      currency: ref.currency,
      asOf: data.timestamp
        ? new Date(data.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      previousClose:
        data.previousClose === undefined || data.previousClose === "NA"
          ? null
          : String(data.previousClose),
    };
  }

  /**
   * Fetch instrument profile (sector/weights, industry, country) from the EODHD
   * `/fundamentals/<ticker>` endpoint.
   *
   * - **Stocks (equity):** uses `filter=General` for a lightweight response; reads
   *   `Sector` → `profile.sector`.
   * - **ETFs:** fetches the full fundamentals payload to access `ETF_Data.Sector_Weights`
   *   (proportional weights per GICS-style sector, e.g. `{ "Technology": 0.29, … }`).
   *   Returns `profile.sectorWeights`; `profile.sector` is left null for ETFs.
   *
   * Returns null when the ticker can't be resolved, the provider errors, or no
   * useful data is returned.
   *
   * Only supports equity and ETF — returns null for other asset classes.
   */
  async getProfile(ref: InstrumentRef): Promise<InstrumentProfile | null> {
    const ticker = this.directTicker(ref) ?? (await this.resolveIsinTicker(ref));
    if (!ticker) return null;

    try {
      if (ref.assetClass === "etf") {
        return await this._getEtfProfile(ticker);
      }
      return await this._getEquityProfile(ticker);
    } catch {
      return null;
    }
  }

  /** Fetch sector/industry/country for a single-company equity via `filter=General`. */
  private async _getEquityProfile(ticker: string): Promise<InstrumentProfile | null> {
    const res = await this.doFetch(
      `${this.baseUrl}/fundamentals/${encodeURIComponent(ticker)}?api_token=${this.apiKey}&fmt=json&filter=General`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      Sector?: string;
      Industry?: string;
      CountryName?: string;
      // When filter=General EODHD flattens the General sub-object to the root.
    } | null;
    if (!data || typeof data !== "object") return null;

    const sector = data.Sector && data.Sector !== "N/A" ? data.Sector : null;
    const industry = data.Industry && data.Industry !== "N/A" ? data.Industry : null;
    const country = data.CountryName && data.CountryName !== "N/A" ? data.CountryName : null;

    if (!sector && !industry && !country) return null;
    return { sector, industry, country };
  }

  /**
   * Fetch per-sector weights for an ETF from `ETF_Data.Sector_Weights`.
   *
   * EODHD response shape (under ETF_Data):
   *   "Sector_Weights": {
   *     "Technology": { "Equity_%": "29.50", "Relative_to_Category": "..." },
   *     "Financials":  { "Equity_%": "13.40", … },
   *     …
   *   }
   *
   * We parse `Equity_%` / 100 for each sector, drop zero / "N/A" entries, and
   * return the resulting fraction map. Returns null when the ETF has no weight data.
   */
  private async _getEtfProfile(ticker: string): Promise<InstrumentProfile | null> {
    const res = await this.doFetch(
      `${this.baseUrl}/fundamentals/${encodeURIComponent(ticker)}?api_token=${this.apiKey}&fmt=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      General?: { CountryName?: string };
      ETF_Data?: {
        Sector_Weights?: Record<string, { Equity_?: string; "Equity_%"?: string }>;
      };
    } | null;
    if (!data || typeof data !== "object") return null;

    const country =
      data.General?.CountryName && data.General.CountryName !== "N/A"
        ? data.General.CountryName
        : null;

    const rawWeights = data.ETF_Data?.Sector_Weights;
    if (!rawWeights || typeof rawWeights !== "object") {
      // ETF exists but EODHD has no weight data — signal an attempt with no results.
      return country ? { sectorWeights: null, country } : null;
    }

    // Parse fraction weights, dropping zero / missing / "N/A" entries.
    const weights: Record<string, number> = {};
    for (const [sector, val] of Object.entries(rawWeights)) {
      if (!val || typeof val !== "object") continue;
      // EODHD uses "Equity_%" as the key (note the percent sign).
      const raw = val["Equity_%"] ?? val["Equity_"];
      if (!raw || raw === "N/A") continue;
      const pct = parseFloat(raw);
      if (!Number.isFinite(pct) || pct <= 0) continue;
      weights[sector] = pct / 100;
    }

    const sectorWeights = Object.keys(weights).length > 0 ? weights : null;
    if (!sectorWeights && !country) return null;
    return { sectorWeights, country };
  }
}
