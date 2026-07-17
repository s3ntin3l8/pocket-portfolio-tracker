export {
  actionClass,
  parseLooseDecimal,
  decimalsClose,
  withinDayTolerance,
  parserToTxSource,
  isEuParser,
  classifyMatch,
} from "./dedup/matcher.js";
export type { DedupCandidate } from "./dedup/matcher.js";
export { findCrossSourceDuplicates } from "./dedup/matcher.js";
export type { SourceRow } from "./dedup/rollup.js";
export { recomputeRollup } from "./dedup/rollup.js";

// NOTE: aggregateByOrderRef was removed (fix 4.2).
// A TR split order (two settlement PDFs, same AUFTRAG/different AUSFÜHRUNG) imports as two
// separate transactions. This is CORRECT — each PDF represents a real settlement (fills at
// different prices/quantities). `packages/core` derives P&L per-transaction, so two legs =
// two real fills = correct cost basis and realized gain.
// The function was never wired into the confirm pipeline (see enrichment.ts, intentionally
// not called). It is removed here to prevent stale "pipeline" documentation from implying
// it runs. If combined timeline rows become desirable in the future, the implementation
// history is available in git. The `orderRef` field remains on `transaction_sources` for
// bookkeeping.
