import { Decimal } from "decimal.js";
import { D, ZERO } from "./decimal.js";
import { isAcquisitionType, isTradeType, isTransferType } from "./categorization.js";
import type { CoreTransaction, CorporateAction, Holding } from "./types.js";
import { augmentTransactionsWithSyntheticMergerLegs } from "./merger-augment.js";

type Event =
  { kind: "tx"; at: Date; tx: CoreTransaction } | { kind: "ca"; at: Date; ca: CorporateAction };

/**
 * Apply a share-count corporate action to a held quantity: a split multiplies it
 * (2:1 → ratio 2 → quantity doubles), a bonus issue adds `ratio` extra shares per held
 * share. Cost basis is unchanged by both — only the per-share average moves. `rights`
 * (needs a paired subscription transaction) and `merger` (handled as sell+buy legs) are
 * no-ops here. Shared by every average-cost pool that must stay split-consistent
 * ({@link computeHoldings}, {@link buildShareTimelines}, the contribution walks).
 *
 * Ordering convention for callers: a transaction at the same instant as the action's
 * `exDate` is processed BEFORE the action (stable sort, transactions queued first).
 */
export function applyShareCorporateAction(qty: Decimal, ca: CorporateAction): Decimal {
  const ratio = D(ca.ratio);
  if (ca.type === "split") return qty.mul(ratio);
  if (ca.type === "bonus") return qty.add(qty.mul(ratio));
  return qty;
}

/** Per-instrument average-cost fold state. */
interface FoldState {
  qty: Decimal;
  costBasis: Decimal;
  realized: Decimal;
  // Cost basis is currency-blind, so every price-bearing transaction for one
  // instrument must share a currency — otherwise the accumulated basis is
  // meaningless. Fail loud rather than produce silently-wrong P&L.
  costCurrency: string | null;
}

function newFoldState(): FoldState {
  return { qty: ZERO, costBasis: ZERO, realized: ZERO, costCurrency: null };
}

function holdingOf(instrumentId: string, st: FoldState): Holding {
  const avgCost = st.qty.gt(0) ? st.costBasis.div(st.qty) : ZERO;
  return {
    instrumentId,
    quantity: st.qty.toString(),
    avgCost: avgCost.toString(),
    costBasis: st.costBasis.toString(),
    realizedPnL: st.realized.toString(),
    costCurrency: st.costCurrency,
  };
}

/** The one per-event step of the average-cost fold, shared by {@link computeHoldings}
 *  and {@link createHoldingsCursor} so the two can never drift. Mutates `st`. */
function foldEvent(instrumentId: string, st: FoldState, ev: Event): void {
  if (ev.kind === "ca") {
    st.qty = applyShareCorporateAction(st.qty, ev.ca);
    return;
  }

  const { type, quantity, price, fees } = ev.tx;
  const q = D(quantity);
  const p = D(price);
  const f = D(fees);

  if (isTradeType(type) || isTransferType(type) || type === "bonus") {
    if (st.costCurrency === null) {
      st.costCurrency = ev.tx.currency;
    } else if (ev.tx.currency !== st.costCurrency) {
      throw new Error(
        `Instrument ${instrumentId} has transactions in multiple currencies ` +
          `(${st.costCurrency} and ${ev.tx.currency}); cost basis can't be computed.`,
      );
    }
  }

  if (isAcquisitionType(type) || type === "bonus") {
    // `bonus` = a zero-cash share *receipt* (free shares — TR perks, FREE_RECEIPT
    // grants, reinvested rewards). The shares are real, so quantity rises; the
    // recorded price is the FMV-at-grant carried as cost basis (price 0 → free shares
    // at zero basis). Distinct from the corporate-action bonus *issue* handled above.
    // It is never a contribution (see contributions.ts isExternalAcquisition).
    st.qty = st.qty.add(q);
    st.costBasis = st.costBasis.add(q.mul(p)).add(f);
  } else if (type === "transfer_in") {
    // Inbound depot transfer: shares arrive at the user's carried cost basis.
    // Fees are typically 0 on a transfer but are added to basis if present.
    st.qty = st.qty.add(q);
    st.costBasis = st.costBasis.add(q.mul(p)).add(f);
  } else if (type === "sell") {
    const sellQty = Decimal.min(q, st.qty);
    const avg = st.qty.gt(0) ? st.costBasis.div(st.qty) : ZERO;
    const costOfSold = avg.mul(sellQty);
    const proceeds = sellQty.mul(p).sub(f);
    st.realized = st.realized.add(proceeds.sub(costOfSold));
    st.qty = st.qty.sub(sellQty);
    st.costBasis = st.costBasis.sub(costOfSold);
  } else if (type === "transfer_out") {
    // Outbound depot transfer: shares leave at average cost. NOT a disposal for
    // P&L purposes (no realized gain/loss — the shares move to another depot, not sold).
    const transferQty = Decimal.min(q, st.qty);
    const avg = st.qty.gt(0) ? st.costBasis.div(st.qty) : ZERO;
    const costOfTransferred = avg.mul(transferQty);
    st.qty = st.qty.sub(transferQty);
    st.costBasis = st.costBasis.sub(costOfTransferred);
  }
  // dividend/coupon/fee/deposit/withdrawal/split/rights don't change holdings.
}

/**
 * Derive per-instrument holdings from transactions using the **average cost**
 * method. Handles buys/savings-plan, sells (realized P&L), transfers, zero-cash
 * `bonus` share receipts (free shares at FMV/zero basis), and split/bonus
 * corporate actions. Cash movements (null instrument) are ignored here.
 *
 * Pass `asOf` to replay only transactions up to (and including) that date.
 * Corporate actions are **always** applied regardless of `asOf`, so the
 * returned quantity is in current share terms — making `histQty / currentQty`
 * ratios split-consistent without extra adjustment.
 */
export function computeHoldings(
  transactions: CoreTransaction[],
  corporateActions: CorporateAction[] = [],
  asOf?: Date,
): Holding[] {
  const byInstrument = new Map<string, Event[]>();

  // Synthesize the sell+buy pair for any taxable merger CA that the importer forgot
  // to write as a `kind:"merger"` pair — mirror of computeTrades' augmentation.
  const txns = augmentTransactionsWithSyntheticMergerLegs(transactions, corporateActions);

  for (const tx of txns) {
    if (!tx.instrumentId) continue;
    // Archived + draft rows are excluded from every derivation (cash_neutral rows still
    // count here — their shares are real; only their cash effect is suppressed in cash.ts).
    if (tx.status === "archived" || tx.status === "draft") continue;
    if (asOf !== undefined && tx.executedAt > asOf) continue;
    const list = byInstrument.get(tx.instrumentId) ?? [];
    list.push({ kind: "tx", at: tx.executedAt, tx });
    byInstrument.set(tx.instrumentId, list);
  }
  for (const ca of corporateActions) {
    const list = byInstrument.get(ca.instrumentId) ?? [];
    list.push({ kind: "ca", at: ca.exDate, ca });
    byInstrument.set(ca.instrumentId, list);
  }

  const holdings: Holding[] = [];

  for (const [instrumentId, events] of byInstrument) {
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    const st = newFoldState();
    for (const ev of events) foldEvent(instrumentId, st, ev);

    holdings.push(holdingOf(instrumentId, st));
  }

  return holdings;
}

// ---------------------------------------------------------------------------
// Incremental holdings (issue #896)
// ---------------------------------------------------------------------------

export interface HoldingsCursor {
  /** Fold every event up to and including `asOf`. Calls must be non-decreasing in `asOf`
   *  (an earlier `asOf` than the last one rewinds and replays from the start). */
  advanceTo(asOf: Date): void;
  /** Exactly `computeHoldings(transactions, corporateActions, asOf)` for the last
   *  `advanceTo(asOf)` — same rows, same order, same strings. */
  snapshot(): Holding[];
  /**
   * The instrument's holding as of `asOf` with the single transaction `tx` left out
   * (what `computeHoldings(transactions.filter(t => t !== tx), …)` would report for it),
   * replaying only that instrument's events. `null` = it would not appear at all;
   * `undefined` = `tx` isn't one of the cursor's rows, or its instrument is on either
   * side of a merger (synthetic legs depend on the quantity held), so the caller must
   * fall back to a full replay.
   */
  holdingWithout(tx: CoreTransaction, asOf: Date): Holding | null | undefined;
}

interface CursorEvent {
  ev: Event;
  /** Position of the transaction in the (merger-augmented) input — drives output order. */
  idx: number;
}

interface CursorInstrument {
  id: string;
  events: CursorEvent[];
  pos: number;
  st: FoldState;
  /** Smallest input index among the consumed transactions (Infinity = none yet). */
  minTxIdx: number;
  /** Index of the instrument's first corporate action in the input (Infinity = none). */
  firstCaIdx: number;
}

/**
 * A forward-only version of {@link computeHoldings}: the per-instrument event lists are
 * built and sorted once, then `advanceTo` folds only the events that became due, so a
 * walk over N dates costs one pass over the transactions instead of N full replays.
 *
 * Equivalence with `computeHoldings(…, asOf)` (guarded by a parity test): that function
 * folds transactions ≤ asOf together with ALL corporate actions in time order. Every
 * corporate action later than `asOf` sorts after every included transaction, so the
 * cursor folds the due prefix and `snapshot` applies the not-yet-due corporate actions to
 * a copy of the quantity, in the same order. Output order mirrors the Map insertion order
 * there: instruments by the input position of their first included transaction, then
 * corporate-action-only instruments by first appearance.
 */
export function createHoldingsCursor(
  transactions: CoreTransaction[],
  corporateActions: CorporateAction[] = [],
): HoldingsCursor {
  const txns = augmentTransactionsWithSyntheticMergerLegs(transactions, corporateActions);
  const byInstrument = new Map<string, CursorInstrument>();
  const instrumentOf = (id: string): CursorInstrument => {
    let inst = byInstrument.get(id);
    if (!inst) {
      inst = {
        id,
        events: [],
        pos: 0,
        st: newFoldState(),
        minTxIdx: Infinity,
        firstCaIdx: Infinity,
      };
      byInstrument.set(id, inst);
    }
    return inst;
  };

  txns.forEach((tx, idx) => {
    if (!tx.instrumentId) return;
    if (tx.status === "archived" || tx.status === "draft") return;
    instrumentOf(tx.instrumentId).events.push({ ev: { kind: "tx", at: tx.executedAt, tx }, idx });
  });
  corporateActions.forEach((ca, idx) => {
    const inst = instrumentOf(ca.instrumentId);
    inst.events.push({ ev: { kind: "ca", at: ca.exDate, ca }, idx });
    inst.firstCaIdx = Math.min(inst.firstCaIdx, idx);
  });
  for (const inst of byInstrument.values()) {
    inst.events.sort((a, b) => a.ev.at.getTime() - b.ev.at.getTime());
  }
  const instruments = [...byInstrument.values()];
  // Synthetic merger legs are sized from the quantity held, so leaving one row out can
  // change them — instruments on either side of a merger always take the full replay.
  const mergerLinked = new Set<string>();
  for (const ca of corporateActions) {
    if (ca.type !== "merger") continue;
    mergerLinked.add(ca.instrumentId);
    if (ca.targetInstrumentId) mergerLinked.add(ca.targetInstrumentId);
  }
  let lastAsOf = -Infinity;

  const reset = () => {
    for (const inst of instruments) {
      inst.pos = 0;
      inst.st = newFoldState();
      inst.minTxIdx = Infinity;
    }
  };

  /** Holding for `inst` with its not-yet-folded corporate actions applied on top. */
  const materialize = (inst: CursorInstrument, from: CursorEvent[], pos: number): Holding => {
    const st: FoldState = { ...inst.st };
    for (let i = pos; i < from.length; i++) {
      const ev = from[i]!.ev;
      if (ev.kind === "ca") st.qty = applyShareCorporateAction(st.qty, ev.ca);
    }
    return holdingOf(inst.id, st);
  };

  return {
    advanceTo(asOf) {
      const t = asOf.getTime();
      if (t < lastAsOf) reset();
      lastAsOf = t;
      for (const inst of instruments) {
        const { events } = inst;
        while (inst.pos < events.length && events[inst.pos]!.ev.at.getTime() <= t) {
          const e = events[inst.pos]!;
          foldEvent(inst.id, inst.st, e.ev);
          if (e.ev.kind === "tx") inst.minTxIdx = Math.min(inst.minTxIdx, e.idx);
          inst.pos++;
        }
      }
    },

    snapshot() {
      const live = instruments.filter((i) => i.minTxIdx !== Infinity || i.firstCaIdx !== Infinity);
      live.sort((a, b) => {
        const aTx = a.minTxIdx !== Infinity;
        const bTx = b.minTxIdx !== Infinity;
        if (aTx !== bTx) return aTx ? -1 : 1;
        return aTx ? a.minTxIdx - b.minTxIdx : a.firstCaIdx - b.firstCaIdx;
      });
      return live.map((i) => materialize(i, i.events, i.pos));
    },

    holdingWithout(tx, asOf) {
      const id = tx.instrumentId;
      const inst = id ? byInstrument.get(id) : undefined;
      if (!id || mergerLinked.has(id)) return undefined;
      if (!inst || !inst.events.some((e) => e.ev.kind === "tx" && e.ev.tx === tx)) {
        return undefined;
      }
      const t = asOf.getTime();
      const scratch: CursorInstrument = { ...inst, st: newFoldState(), minTxIdx: Infinity };
      const rest = inst.events.filter((e) => !(e.ev.kind === "tx" && e.ev.tx === tx));
      let pos = 0;
      while (pos < rest.length && rest[pos]!.ev.at.getTime() <= t) {
        const e = rest[pos]!;
        foldEvent(inst.id, scratch.st, e.ev);
        if (e.ev.kind === "tx") scratch.minTxIdx = Math.min(scratch.minTxIdx, e.idx);
        pos++;
      }
      if (scratch.minTxIdx === Infinity && inst.firstCaIdx === Infinity) return null;
      return materialize(scratch, rest, pos);
    },
  };
}

// ---------------------------------------------------------------------------
// Share-count timeline (issue #508) — derives implied shares/per-share for income
// rows whose source doesn't carry them (e.g. a TR CSV/IBKR dividend row, or any
// income row still missing the field after source-specific parsing).
// ---------------------------------------------------------------------------

/** Qty-changing transaction types — mirrors the branches in computeHoldings' loop
 *  (89-118) that mutate `qty`. Kept in sync with that switch; dividend/coupon/fee/
 *  deposit/withdrawal/split/rights don't affect quantity there and are excluded here. */
const QTY_AFFECTING_TYPES = new Set([
  "buy",
  "savings_plan",
  "sell",
  "transfer_in",
  "transfer_out",
  "bonus",
]);

/** Net shares held immediately after the event at `at`, on the running timeline. */
export interface ShareCheckpoint {
  at: Date;
  qty: Decimal;
}

/**
 * Build a running share-count timeline per instrument — for looking up how many shares
 * were held at an arbitrary date via `sharesHeldAt`. Used to derive an income
 * transaction's implied share count when the source data doesn't carry one (#508).
 *
 * Mirrors computeHoldings' quantity-mutation rules (`QTY_AFFECTING_TYPES` above; sell/
 * transfer_out clamp to the held quantity exactly as computeHoldings does) so the two
 * can't silently diverge.
 *
 * Deliberately DIFFERENT from computeHoldings' `asOf` semantics: corporate actions here
 * are applied INLINE at their `exDate`, scaling only the quantity accumulated so far —
 * NOT retroactively across the whole series. A lookup at date D therefore returns the
 * share count actually held AT D (pre any later split/bonus), matching what a
 * settlement PDF or CSV prints for a payment on that date.
 *
 * Do NOT reuse `computeHoldings(asOf)` for this: it intentionally applies *every*
 * corporate action regardless of `asOf` (so historical ratios stay split-consistent in
 * today's share terms — see its own doc comment). Reused here, a split that happened
 * AFTER a dividend's pay date would silently rescale that dividend's derived share
 * count, corrupting `perShare = gross / shares` against the pay-date-actual value the
 * source document/parser prints.
 */
export function buildShareTimelines(
  transactions: CoreTransaction[],
  corporateActions: CorporateAction[] = [],
): Map<string, ShareCheckpoint[]> {
  const byInstrument = new Map<string, Event[]>();

  for (const tx of transactions) {
    if (!tx.instrumentId) continue;
    if (tx.status === "archived" || tx.status === "draft") continue;
    if (!QTY_AFFECTING_TYPES.has(tx.type)) continue;
    const list = byInstrument.get(tx.instrumentId) ?? [];
    list.push({ kind: "tx", at: tx.executedAt, tx });
    byInstrument.set(tx.instrumentId, list);
  }
  for (const ca of corporateActions) {
    const list = byInstrument.get(ca.instrumentId) ?? [];
    list.push({ kind: "ca", at: ca.exDate, ca });
    byInstrument.set(ca.instrumentId, list);
  }

  const out = new Map<string, ShareCheckpoint[]>();
  for (const [instrumentId, events] of byInstrument) {
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    let qty = ZERO;
    const checkpoints: ShareCheckpoint[] = [];

    for (const ev of events) {
      if (ev.kind === "ca") {
        qty = applyShareCorporateAction(qty, ev.ca);
        checkpoints.push({ at: ev.at, qty });
        continue;
      }

      const { type, quantity } = ev.tx;
      const q = D(quantity);

      if (isAcquisitionType(type) || type === "bonus" || type === "transfer_in") {
        qty = qty.add(q);
      } else if (type === "sell" || type === "transfer_out") {
        qty = qty.sub(Decimal.min(q, qty));
      }
      checkpoints.push({ at: ev.at, qty });
    }

    out.set(instrumentId, checkpoints);
  }

  return out;
}

/**
 * Number of shares held immediately after all events at-or-before `at`, per the
 * timeline built by `buildShareTimelines`. Returns null when the instrument has no
 * timeline (never traded) or the held quantity is not positive — an income row with
 * no matching holding can't have its shares/per-share derived.
 */
export function sharesHeldAt(
  timelines: Map<string, ShareCheckpoint[]>,
  instrumentId: string,
  at: Date,
): Decimal | null {
  const checkpoints = timelines.get(instrumentId);
  if (!checkpoints || checkpoints.length === 0) return null;

  // Binary search for the last checkpoint with `at <= target` — mirrors computeHoldings'
  // asOf convention (`tx.executedAt > asOf` is excluded, i.e. `<=` is included).
  const target = at.getTime();
  let lo = 0;
  let hi = checkpoints.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (checkpoints[mid].at.getTime() <= target) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (result === -1) return null;

  const qty = checkpoints[result].qty;
  return qty.gt(0) ? qty : null;
}

/** Market value of a holding at a given unit price. */
export function marketValue(quantity: string, price: string): string {
  return D(quantity).mul(D(price)).toString();
}

/** Unrealized P&L = market value − remaining cost basis. */
export function unrealizedPnL(quantity: string, price: string, costBasis: string): string {
  return D(quantity).mul(D(price)).sub(D(costBasis)).toString();
}
