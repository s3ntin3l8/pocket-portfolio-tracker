export { resolveDraftInstruments, type ResolvedDraft } from "./materialize-drafts/instruments.js";
export {
  classifyDraftDuplicates,
  type DuplicateClassification,
  type CommittedCandidate,
} from "./materialize-drafts/duplicates.js";
export {
  decideDuplicates,
  type DuplicateAction,
  type DuplicateDecisions,
  type DuplicateMatch,
  type DuplicateResolution,
} from "./materialize-drafts/resolutions.js";
export { writeResolvedDrafts, materializeDrafts } from "./materialize-drafts/write.js";
export type { TxRow } from "./materialize-drafts/types.js";
