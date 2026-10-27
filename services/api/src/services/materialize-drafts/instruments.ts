import { and, eq, sql } from "drizzle-orm";
import { instruments, transactions } from "@portfolio/db";
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
  opts: {
    isEu: boolean;
    /**
     * Imports that mix instrument kinds (AI-assisted entry): use the ISIN/EU resolution for the
     * drafts that carry an ISIN, and the symbol-based path for the rest.
     */
    euWhenIsin?: boolean;
    /**
     * The portfolio the drafts land in. A `tax` draft with an ISIN is linked only to an instrument
     * this portfolio already trades (or one the same batch creates); without it, none is linked.
     */
    portfolioId?: string;
  },
): Promise<ResolvedDraft[]> {
  const { euWhenIsin = false } = opts;
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
  // Tax drafts that carry an ISIN (a Vorabpauschale names its fund) are linked in a second pass,
  // once the batch's own instruments exist; they never create one.
  const taxByIsin: number[] = [];
  for (const d of drafts) {
    const isEu = opts.isEu || (euWhenIsin && Boolean(d.isin));
    // A standalone `tax` row (TR CSV Vorabpauschale: "no instrument leg", only a label in
    // `name`) is a cash debit, not a position — creating an instrument from its name would add
    // a junk symbol that every price job then tries to fetch. A tax draft that carries an
    // ISIN is link-only (second pass below: an instrument the portfolio already trades, never a
    // new one); one with a ticker resolves an instrument as before.
    const linkOnly = d.action === "tax" && Boolean(d.isin) && !d.ticker;
    const isCash =
      linkOnly ||
      d.action === "deposit" ||
      d.action === "withdrawal" ||
      d.action === "interest" ||
      d.action === "bonus_cash" ||
      (d.action === "tax" && !d.isin && !d.ticker);
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
          actor: { isAdmin: false },
          resolveMarket: async (isin) => {
            const r = await resolveEuIsin(isin);
            return r ? { market: r.market, currency: r.currency } : null;
          },
        },
      );
      instrumentId = instrument.id;
    }
    if (linkOnly) taxByIsin.push(resolved.length);
    resolved.push({ draft: d, instrumentId });
  }

  if (taxByIsin.length > 0) {
    const batchIds = new Set(
      resolved.filter((r) => r.draft.action !== "tax" && r.instrumentId).map((r) => r.instrumentId),
    );
    for (const i of taxByIsin) {
      const isin = resolved[i]!.draft.isin!.toUpperCase();
      const [inst] = await ctx.db
        .select({ id: instruments.id })
        .from(instruments)
        // Stored verbatim by findOrCreateInstrument, so compare case-insensitively.
        .where(sql`upper(${instruments.isin}) = ${isin}`)
        .limit(1);
      if (!inst) continue;
      let held = batchIds.has(inst.id);
      if (!held && opts.portfolioId) {
        const [tx] = await ctx.db
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.portfolioId, opts.portfolioId),
              eq(transactions.instrumentId, inst.id),
            ),
          )
          .limit(1);
        held = Boolean(tx);
      }
      if (held) resolved[i] = { ...resolved[i]!, instrumentId: inst.id };
    }
  }
  return resolved;
}
