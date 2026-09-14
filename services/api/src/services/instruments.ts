import { and, eq } from "drizzle-orm";
import { instruments, prices } from "@portfolio/db";
import { toDateKey } from "@portfolio/core";
import { isIsin, isKnownMarket, PRICEABLE_FOREIGN_MARKETS } from "@portfolio/market-data";
import type { InstrumentInput } from "@portfolio/schema";
import type { DB } from "../db/client.js";

type Instrument = typeof instruments.$inferSelect;

/**
 * Fields an existing instrument should adopt from a fresh `input` when the input is
 * strictly better — so a row created before ISIN/asset-class resolution worked (e.g. an
 * ISIN stored as the symbol, or a UCITS ETF mislabelled `mutual_fund`) self-heals on the
 * next import instead of staying stuck. Only upgrades; never downgrades.
 */
function instrumentUpgrade(
  existing: Instrument,
  input: Omit<InstrumentInput, "isin" | "wkn"> & { isin?: string | null; wkn?: string | null },
): Partial<
  Pick<
    Instrument,
    | "symbol"
    | "assetClass"
    | "market"
    | "currency"
    | "isin"
    | "wkn"
    | "faceValue"
    | "couponRate"
    | "couponSchedule"
    | "maturityDate"
  >
> {
  const set: Partial<
    Pick<
      Instrument,
      | "symbol"
      | "assetClass"
      | "market"
      | "currency"
      | "isin"
      | "wkn"
      | "faceValue"
      | "couponRate"
      | "couponSchedule"
      | "maturityDate"
    >
  > = {};
  // Replace an ISIN-as-symbol with a real ticker (but never the reverse).
  if (isIsin(existing.symbol) && !isIsin(input.symbol)) set.symbol = input.symbol;
  // Refine the generic defaults (`equity`, `mutual_fund`) to a more specific class —
  // notably `mutual_fund` → `etf` — but don't clobber a specific class with the default.
  if (
    input.assetClass !== existing.assetClass &&
    input.assetClass !== "equity" &&
    (existing.assetClass === "equity" || existing.assetClass === "mutual_fund")
  )
    set.assetClass = input.assetClass;
  // Re-pin a row stuck on the EU-broker default (Xetra/EUR) OR on an unrecognised market
  // (e.g. a legacy row with market "PE" from a raw provider exchange code) to its real
  // tradeable venue when a fresh import resolves one our providers price directly (US stocks,
  // crypto). The input-side guard on PRICEABLE_FOREIGN_MARKETS is intentional: if ISIN
  // resolution failed on re-import, input.market is XETRA — dropping the guard would trade
  // one bad market for another. Real EUR funds are never touched (their resolved market stays
  // XETRA/EUR, which is not in PRICEABLE_FOREIGN_MARKETS).
  if (
    (existing.market === "XETRA" && existing.currency === "EUR") ||
    !isKnownMarket(existing.market)
  ) {
    if (PRICEABLE_FOREIGN_MARKETS.has(input.market)) {
      set.market = input.market;
      set.currency = input.currency;
    }
  }
  // Back-fill missing ISIN/WKN when the input carries one.
  if (!existing.isin && input.isin) set.isin = input.isin;
  if (!existing.wkn && input.wkn) set.wkn = input.wkn;
  // Back-fill bond terms — but ONLY when the existing column is null (never overwrite a
  // value another user or import already set) and ONLY when the EXISTING row is already
  // a bond. Deliberately checking `existing`, not `input`: `instrumentInputSchema` only
  // accepts bond fields when `input.assetClass === "bond"`, so gating on
  // `input.assetClass === "bond"` (as an earlier version of this guard did) is always
  // true whenever there's anything to back-fill — it can never distinguish "an
  // unrelated equity/fund row collided by (symbol, market) with a bond input" from "both
  // sides are genuinely a bond," which is exactly the case this guard exists to reject.
  // `instruments` is shared reference data across users, so this is deliberately a
  // one-way upgrade, matching every other rule in this function; correcting a wrong
  // value goes through the admin-gated PATCH /instruments/:id route.
  if (existing.assetClass === "bond") {
    if (existing.faceValue == null && input.faceValue !== undefined)
      set.faceValue = input.faceValue;
    if (existing.couponRate == null && input.couponRate !== undefined)
      set.couponRate = input.couponRate;
    if (existing.couponSchedule == null && input.couponSchedule !== undefined)
      set.couponSchedule = input.couponSchedule;
    if (existing.maturityDate == null && input.maturityDate !== undefined)
      set.maturityDate = input.maturityDate;
  }
  return set;
}

/** Apply an upgrade if non-empty, returning the (possibly updated) row. */
async function healInstrument(
  db: DB,
  existing: Instrument,
  input: Omit<InstrumentInput, "isin" | "wkn"> & { isin?: string | null; wkn?: string | null },
): Promise<Instrument> {
  const set = instrumentUpgrade(existing, input);
  if (Object.keys(set).length === 0) return existing;
  const [updated] = await db
    .update(instruments)
    .set(set)
    .where(eq(instruments.id, existing.id))
    .returning();
  return updated ?? existing;
}

/**
 * Default market for an asset class when the caller doesn't specify one. Gold
 * holdings use the Antam buyback market (valued at the buyback price); XAU spot is
 * reserved for the live ticker.
 */
export function marketForAssetClass(assetClass: string): string {
  return assetClass === "gold" ? "ANTAM" : "IDX";
}

/**
 * Default market for a security imported from a German broker (DKB depot). These trade
 * on Xetra in EUR; we don't rely on `marketForAssetClass` (which defaults to IDX) so the
 * Indonesian default stays untouched.
 */
export function marketForEuInstrument(_assetClass?: string | null): string {
  return "XETRA";
}

/**
 * Optional dependencies for `findOrCreateInstrument`.
 *
 * @param resolveMarket - Best-effort callback: given an ISIN, returns the canonical
 *   `{ market, currency }` from an external registry (OpenFIGI). Called only when the
 *   input carries an ISIN whose market is not a recognised internal code. Failures and
 *   `null` results are silently ignored so a missing/rate-limited response never blocks
 *   an import.
 */
export interface FindOrCreateOpts {
  resolveMarket?: (isin: string) => Promise<{ market: string; currency: string } | null>;
}

/**
 * Find an instrument by ISIN, then WKN, then (market, symbol) identity, creating it if
 * absent. ISIN and WKN matches also back-fill the missing identifier on existing rows so
 * imports that arrive in any order converge to a single fully-identified row.
 *
 * Pass `opts.resolveMarket` to enable create-time market correction: when the input
 * carries an ISIN with an unrecognised market, the resolver is queried and its result
 * (if it returns a known market) replaces the input market and currency for both the
 * identity lookup and the new-row insert.
 */
export async function findOrCreateInstrument(
  db: DB,
  input: Omit<InstrumentInput, "isin" | "wkn"> & { isin?: string | null; wkn?: string | null },
  opts?: FindOrCreateOpts,
): Promise<Instrument> {
  if (input.isin) {
    const [byIsin] = await db
      .select()
      .from(instruments)
      .where(eq(instruments.isin, input.isin))
      .limit(1);
    if (byIsin) return healInstrument(db, byIsin, input);
  }

  if (input.wkn) {
    const [byWkn] = await db
      .select()
      .from(instruments)
      .where(eq(instruments.wkn, input.wkn))
      .limit(1);
    if (byWkn) return healInstrument(db, byWkn, input);
  }

  // Correct an unrecognised market before the (symbol, market) identity lookup and
  // the new-row insert. Gated on having an ISIN + an unrecognised market. The resolver
  // is only wired in non-test builds (it's not passed in PGlite tests), and its failures
  // are silently caught so a rate-limit or network error never blocks a confirm.
  let market = input.market;
  let currency = input.currency;
  if (opts?.resolveMarket && input.isin && !isKnownMarket(market)) {
    try {
      const r = await opts.resolveMarket(input.isin);
      if (r && isKnownMarket(r.market)) {
        market = r.market;
        currency = r.currency;
      }
    } catch {
      // best-effort; keep import-provided market
    }
  }

  const [existing] = await db
    .select()
    .from(instruments)
    .where(and(eq(instruments.symbol, input.symbol), eq(instruments.market, market)))
    .limit(1);
  if (existing) return healInstrument(db, existing, input);

  const [created] = await db
    .insert(instruments)
    .values({
      symbol: input.symbol,
      market,
      assetClass: input.assetClass,
      unit: input.unit,
      currency,
      name: input.name,
      isin: input.isin ?? null,
      wkn: input.wkn ?? null,
      ...(input.assetClass === "bond"
        ? {
            faceValue: input.faceValue ?? null,
            couponRate: input.couponRate ?? null,
            couponSchedule: input.couponSchedule ?? null,
            maturityDate: input.maturityDate ?? null,
          }
        : {}),
    })
    .returning();
  return created;
}

/**
 * Update a subset of an instrument's editable fields. Rejects with "conflict" when
 * an ISIN or WKN would collide with another existing row.
 */
export async function updateInstrument(
  db: DB,
  id: string,
  patch: {
    isin?: string | null;
    wkn?: string | null;
    symbol?: string;
    name?: string;
    assetClass?: string;
    market?: string;
    faceValue?: string | null;
    couponRate?: string | null;
    couponSchedule?: string | null;
    maturityDate?: string | null;
  },
): Promise<Instrument | "conflict" | "not_found"> {
  const [existing] = await db.select().from(instruments).where(eq(instruments.id, id)).limit(1);
  if (!existing) return "not_found";

  // Guard uniqueness manually so we can return a typed error instead of a DB exception.
  if (patch.isin && patch.isin !== existing.isin) {
    const [clash] = await db
      .select()
      .from(instruments)
      .where(and(eq(instruments.isin, patch.isin)))
      .limit(1);
    if (clash && clash.id !== id) return "conflict";
  }
  if (patch.wkn && patch.wkn !== existing.wkn) {
    const [clash] = await db
      .select()
      .from(instruments)
      .where(and(eq(instruments.wkn, patch.wkn)))
      .limit(1);
    if (clash && clash.id !== id) return "conflict";
  }

  const set: Record<string, unknown> = {};
  if ("isin" in patch) set.isin = patch.isin ?? null;
  if ("wkn" in patch) set.wkn = patch.wkn ?? null;
  if (patch.symbol !== undefined) set.symbol = patch.symbol;
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.assetClass !== undefined) set.assetClass = patch.assetClass;
  if (patch.market !== undefined) set.market = patch.market;
  if (patch.faceValue !== undefined) set.faceValue = patch.faceValue;
  if (patch.couponRate !== undefined) set.couponRate = patch.couponRate;
  if (patch.couponSchedule !== undefined) set.couponSchedule = patch.couponSchedule;
  if (patch.maturityDate !== undefined) set.maturityDate = patch.maturityDate;

  if (Object.keys(set).length === 0) return existing;

  const [updated] = await db.update(instruments).set(set).where(eq(instruments.id, id)).returning();
  return updated ?? existing;
}

/**
 * Set or clear an instrument's user-maintained manual price (absolute, per-unit, in the
 * instrument's own currency). Substitutes for a live market-data provider on asset
 * classes none of them serve — e.g. Indonesian retail bonds/sukuk, where no schedulable
 * secondary-market feed exists (see docs/data_providers.md). Read in valuePortfolio()
 * ahead of the bond par fallback; NOT admin-gated — like POST /instruments, maintaining a
 * price for a series you hold is a normal, load-bearing action, not reference-data
 * curation. `instruments` is shared across users, so this does change valuation for
 * everyone holding the series — that's an accepted, deliberate consequence.
 *
 * Also writes (or deletes) a `prices` row at `manualPriceAt` so that consumers that
 * read the historical price series directly — the sparkline chart (`sparklines.ts`) and
 * the concentration/movers insight (`concentration.ts`) — reflect the manual price as a
 * step-change at the date it was set. Multiple manual-price sets produce multiple
 * `prices` rows; clearing the price removes only the row matching the old `manualPriceAt`.
 */
export async function setManualPrice(
  db: DB,
  id: string,
  price: string | null,
): Promise<Instrument | "not_found"> {
  const [existing] = await db.select().from(instruments).where(eq(instruments.id, id)).limit(1);
  if (!existing) return "not_found";

  const now = price === null ? null : new Date();
  const [updated] = await db
    .update(instruments)
    .set({ manualPrice: price, manualPriceAt: now })
    .where(eq(instruments.id, id))
    .returning();
  const result = updated ?? existing;

  if (price !== null && now) {
    // Write a prices row at the manual-price date so sparklines/concentration pick it up.
    const dateKey = toDateKey(now);
    await db
      .insert(prices)
      .values({ instrumentId: id, date: dateKey, close: price, currency: existing.currency })
      .onConflictDoUpdate({
        target: [prices.instrumentId, prices.date],
        set: { close: price, currency: existing.currency },
      });
  } else if (price === null && existing.manualPriceAt) {
    // Clearing the manual price — remove the prices row for the old manualPriceAt date.
    const oldDateKey = toDateKey(new Date(existing.manualPriceAt));
    await db.delete(prices).where(and(eq(prices.instrumentId, id), eq(prices.date, oldDateKey)));
  }

  return result;
}
