import type { Decimal } from "decimal.js";
import { D, ZERO } from "../decimal.js";
import { splitAdjustmentFactor } from "../twr.js";
import type { CoreTransaction, CorporateAction } from "../types.js";
import { BASISZINS_BY_YEAR, vorabpauschalePerUnit, vorabZuflussDate } from "./rates.js";

export interface VorabEstimateInput {
  transactions: CoreTransaction[];
  corporateActions: CorporateAction[];
  /** Only fund instruments (equity/mixed funds, ETFs) accrue a Vorabpauschale. */
  isFund: (instrumentId: string) => boolean;
  /** Raw (NOT split-adjusted) close on or before `date` (YYYY-MM-DD), or null when the
   *  price history has nothing close enough. */
  priceOn: (instrumentId: string, date: string) => { close: string; currency: string } | null;
  now: Date;
  warn?: (msg: string) => void;
}

interface Lot {
  qty: Decimal; // current share terms (corporate actions applied)
  acquiredAt: Date;
}

const ACQUIRE = new Set(["buy", "savings_plan", "transfer_in", "bonus"]);
const DISPOSE = new Set(["sell", "transfer_out"]);

const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/** Calendar year a broker-booked Vorabpauschale row is "for": the amount is deemed received
 *  on the first working day of Y+1, so a row dated in December of Y or in January–November of
 *  Y+1 is for year Y (December always belongs to its own year, every other month to the
 *  previous one). This matches how the trade log buckets it (by the row's own year), so a
 *  late-booked broker row can never be accrued on top of an estimate for the same year. */
function brokerRowYear(at: Date): number {
  return at.getUTCMonth() === 11 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
}

/**
 * Derive Vorabpauschale accrual rows (§18 InvStG) for fund holdings whose broker supplied
 * none, so the trade log's accrual/disposal-credit tracking has a base to work with.
 *
 * Per fund and completed calendar year Y (from the first year with an official Basiszins):
 *  - skipped when a broker-booked Vorabpauschale row exists for (instrument, Y) — the
 *    broker's figure always wins;
 *  - only units still held at 31 Dec count (the Vorabpauschale arises at year end); units
 *    sold during the year get none (unit lots are consumed FIFO);
 *  - the per-unit amount uses the price at the start and end of the year for EVERY unit
 *    (§18 Abs. 1: the cap uses the first/last Rücknahmepreis of the calendar year), then
 *    units bought during the year are reduced 1/12 per full month before the purchase
 *    month (§18 Abs. 2);
 *  - a missing price, a price in another currency, or an unknown Basiszins yields NO row
 *    (and a warning) — never a zero or guessed base.
 *
 * The rows are derived, never persisted: `estimated: true`, `executedAt` = the deemed
 * receipt day (first working day of Y+1). Pre-2023 years are out of scope (no table).
 */
export function estimateVorabRows(input: VorabEstimateInput): CoreTransaction[] {
  const { corporateActions: cas, now, warn } = input;
  const firstYear = Math.min(...Object.keys(BASISZINS_BY_YEAR).map(Number));
  const lastYear = now.getUTCFullYear() - 1;
  if (lastYear < firstYear) return [];

  const byInstrument = new Map<string, CoreTransaction[]>();
  for (const tx of input.transactions) {
    if (!tx.instrumentId || tx.status === "archived" || tx.status === "draft") continue;
    if (!input.isFund(tx.instrumentId)) continue;
    const list = byInstrument.get(tx.instrumentId) ?? [];
    list.push(tx);
    byInstrument.set(tx.instrumentId, list);
  }

  const out: CoreTransaction[] = [];
  for (const [id, txns] of byInstrument) {
    const rows = [...txns].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
    const currencies = new Set(rows.map((r) => r.currency));
    if (currencies.size !== 1) {
      warn?.(`Vorabpauschale estimate skipped for ${id}: mixed transaction currencies.`);
      continue;
    }
    const currency = rows[0]!.currency;

    const brokerYears = new Set<number>();
    for (const r of rows) {
      if (r.type === "tax" && r.kind === "vorabpauschale") {
        brokerYears.add(brokerRowYear(r.executedAt));
      }
    }

    const lots: Lot[] = [];
    let idx = 0;
    for (let year = firstYear; year <= lastYear; year++) {
      const yearEnd = Date.UTC(year, 11, 31, 23, 59, 59, 999);
      let distPerUnit = ZERO;
      for (; idx < rows.length && rows[idx]!.executedAt.getTime() <= yearEnd; idx++) {
        const r = rows[idx]!;
        const factor = splitAdjustmentFactor(cas, id, dateKey(r.executedAt));
        if (ACQUIRE.has(r.type)) {
          const qty = D(r.quantity).mul(factor);
          if (qty.gt(0)) lots.push({ qty, acquiredAt: r.executedAt });
        } else if (DISPOSE.has(r.type)) {
          let remaining = D(r.quantity).mul(factor);
          while (remaining.gt(0) && lots.length > 0) {
            const lot = lots[0]!;
            const take = remaining.lt(lot.qty) ? remaining : lot.qty;
            lot.qty = lot.qty.sub(take);
            remaining = remaining.sub(take);
            if (lot.qty.lte(0)) lots.shift();
          }
        } else if (r.type === "dividend" && r.executedAt.getUTCFullYear() === year) {
          const units = lots.reduce((s, l) => s.add(l.qty), ZERO);
          if (units.gt(0)) {
            const q = D(r.quantity);
            const cash = q.gt(0) ? D(r.price).mul(q) : D(r.price);
            // `tax` is withholding already netted out of `price`; the distribution is gross.
            const gross = cash.add(D(r.tax ?? "0"));
            distPerUnit = distPerUnit.add(gross.div(units));
          }
        }
      }

      if (brokerYears.has(year)) continue;
      if (vorabZuflussDate(year).getTime() > now.getTime()) continue;
      const unitsEnd = lots.reduce((s, l) => s.add(l.qty), ZERO);
      if (unitsEnd.lte(0)) continue;

      const startKey = `${year}-01-01`;
      const endKey = `${year}-12-31`;
      const p0 = input.priceOn(id, startKey);
      const p1 = input.priceOn(id, endKey);
      if (!p0 || !p1) {
        warn?.(
          `Vorabpauschale ${year} not estimated for ${id}: no price near ${!p0 ? startKey : endKey}.`,
        );
        continue;
      }
      if (p0.currency !== currency || p1.currency !== currency) {
        warn?.(
          `Vorabpauschale ${year} not estimated for ${id}: price currency differs from transactions.`,
        );
        continue;
      }
      // Quantities are in current share terms, so bring the raw prices to the same basis.
      const start = D(p0.close).div(splitAdjustmentFactor(cas, id, startKey));
      const end = D(p1.close).div(splitAdjustmentFactor(cas, id, endKey));
      const perUnit = vorabpauschalePerUnit({
        year,
        priceStartOfYear: start.toString(),
        priceEndOfYear: end.toString(),
        distributionsPerUnit: distPerUnit.toString(),
        warn,
      });
      if (perUnit === null || perUnit.lte(0)) continue;

      let total = ZERO;
      for (const lot of lots) {
        const months =
          lot.acquiredAt.getUTCFullYear() < year ? 12 : 12 - lot.acquiredAt.getUTCMonth();
        total = total.add(lot.qty.mul(perUnit).mul(months).div(12));
      }
      const base = total.toFixed(2);
      if (D(base).lte(0)) continue;
      out.push({
        id: `estimated-vorab:${id}:${year}`,
        instrumentId: id,
        type: "tax",
        kind: "vorabpauschale",
        quantity: "0",
        price: "0",
        fees: "0",
        currency,
        executedAt: vorabZuflussDate(year),
        vorabBase: base,
        estimated: true,
        status: "normal",
      });
    }
  }
  return out;
}
