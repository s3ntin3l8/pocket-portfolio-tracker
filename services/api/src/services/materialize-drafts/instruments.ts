import type { ParsedTransaction, AssetClass } from "@portfolio/schema";
import {
  findOrCreateInstrument,
  marketForAssetClass,
  marketForEuInstrument,
} from "../instruments.js";
import { getMarketData } from "../market-data.js";
import {
  resolveCryptoIsin,
  PRICEABLE_FOREIGN_MARKETS,
  isIdxEtfSymbol,
} from "@portfolio/market-data";
import type { Ctx } from "./types.js";

export type ResolvedDraft = { draft: ParsedTransaction; instrumentId: string | null };

export async function resolveDraftInstruments(
  ctx: Ctx,
  drafts: ParsedTransaction[],
  opts: { isEu: boolean },
): Promise<ResolvedDraft[]> {
  const { isEu } = opts;
  const log = ctx.log;

  const isinCache = new Map<
    string,
    { symbol: string; market: string; currency: string; assetClass: AssetClass } | null
  >();
  async function resolveEuIsin(isin: string) {
    if (isinCache.has(isin)) return isinCache.get(isin)!;
    let resolved: {
      symbol: string;
      market: string;
      currency: string;
      assetClass: AssetClass;
    } | null = null;
    const crypto = resolveCryptoIsin(isin);
    if (crypto) {
      resolved = { ...crypto, currency: "EUR" };
    } else {
      try {
        const md = await getMarketData();
        const [hit] = await md.search(isin);
        if (hit) {
          resolved = {
            symbol: hit.symbol,
            market: hit.market,
            currency: hit.currency,
            assetClass: hit.assetClass,
          };
        }
      } catch (err) {
        log?.warn({ isin, err }, "isin resolve failed");
      }
    }
    isinCache.set(isin, resolved);
    return resolved;
  }

  const resolved: ResolvedDraft[] = [];
  for (const d of drafts) {
    const isCash =
      d.action === "deposit" ||
      d.action === "withdrawal" ||
      d.action === "interest" ||
      d.action === "bonus_cash";
    let instrumentId: string | null = null;

    if (!isCash) {
      let symbol = d.ticker ?? d.isin ?? d.name ?? "UNKNOWN";
      let market = isEu
        ? marketForEuInstrument(d.assetClass)
        : marketForAssetClass(d.assetClass ?? "equity");
      let instrumentCurrency = d.currency;
      let assetClass = d.assetClass ?? "equity";

      if (!isEu && assetClass === "mutual_fund" && market === "IDX" && isIdxEtfSymbol(symbol))
        assetClass = "etf";

      if (isEu && d.isin) {
        const r = await resolveEuIsin(d.isin);
        if (r) {
          symbol = r.symbol;
          assetClass = r.assetClass;
          if (
            PRICEABLE_FOREIGN_MARKETS.has(r.market) &&
            (r.market !== "US" || (d.isin ?? "").toUpperCase().startsWith("US"))
          ) {
            market = r.market;
            instrumentCurrency = r.currency;
          }
        }
      }

      const instrument = await findOrCreateInstrument(
        ctx.db,
        {
          symbol,
          market,
          assetClass,
          unit: d.unit ?? "shares",
          currency: instrumentCurrency,
          name: d.name ?? symbol,
          isin: d.isin ?? null,
          wkn: d.wkn ?? null,
        },
        {
          resolveMarket: async (isin) => {
            const r = await resolveEuIsin(isin);
            return r ? { market: r.market, currency: r.currency } : null;
          },
        },
      );
      instrumentId = instrument.id;
    }
    resolved.push({ draft: d, instrumentId });
  }
  return resolved;
}
