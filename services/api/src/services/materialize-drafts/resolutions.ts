import type { CommittedCandidate } from "./duplicates.js";

/** A draft that economically matches an existing transaction. */
export type DuplicateMatch = { draftIndex: number; matched: CommittedCandidate };

/** What the user (or the blanket acknowledgement) decided to do with a draft. */
export type DuplicateAction = "skip" | "import" | "enrich";

export type DuplicateResolution = { draftIndex: number; action: DuplicateAction };

export type DuplicateDecisions = {
  /** Drafts to fold into a matched transaction: draft index → matched transaction id. */
  enrichmentMatches: Array<{ draftIndex: number; matchedTransactionId: string }>;
  /** Drafts the user explicitly skipped — neither written nor folded into anything. */
  skippedIndices: Set<number>;
  /** Duplicates that still block and need a decision. */
  blockedPlain: DuplicateMatch[];
  blockedPending: DuplicateMatch[];
  /** Counts for the response/log. */
  counts: {
    /**
     * The plain duplicates found — *before* the blanket acknowledgement cleared them. The
     * response reports how many duplicates the import hit, not how many are still blocking.
     */
    duplicates: number;
    /** Duplicates of an unconfirmed row — these always need an explicit decision. */
    pending: number;
    enrichments: number;
    skipped: number;
  };
};

/**
 * Turn the classifier's output plus the user's per-row decisions into the concrete
 * "what do we do with each draft" answer.
 *
 * The rules, in order:
 *
 * 1. An **enrichment** match (different source, the import brings something new) is
 *    auto-applied: the draft is folded into the matched transaction instead of being
 *    written. It never blocks.
 * 2. A **plain duplicate** (same source, or nothing new to contribute) blocks with a 409
 *    until the user decides. The blanket `acknowledgeDuplicates` flag clears it — that is
 *    the historical behaviour and it stays, so existing clients keep working.
 * 3. A **pending** duplicate (the match is an unconfirmed transaction row) always blocks.
 *    The blanket flag must not decide what happens to an unconfirmed row — the user does.
 * 4. An explicit per-row resolution always wins over the blanket flag:
 *    - `"skip"` — the draft is neither written nor folded into anything. The confirm
 *      path expresses this by not sending the draft at all; the materialise path sends it
 *      with this disposition, because there the draft array is the server's own and stays
 *      stable across the retry.
 *    - `"import"` — the draft is written even though it duplicates an existing trade.
 *    - `"enrich"` — the draft is folded into the matched transaction.
 *
 * `mode` covers the one case where there is no user to ask: a **broker sync** has no
 * review screen, so a cross-source match against a *confirmed* row is merged into it
 * rather than blocking forever. The broker's data is authoritative and merging is
 * strictly better than double-counting. A match against a *pending* row is still never
 * merged — that row is unconfirmed, and merging into it would resolve a broker event
 * against a trade the user may still discard.
 */
export function decideDuplicates(args: {
  enrichmentMatches: Array<{ draftIndex: number; matchedTransactionId: string }>;
  plainDuplicates: DuplicateMatch[];
  pendingDuplicates: DuplicateMatch[];
  resolutions?: DuplicateResolution[];
  acknowledgeDuplicates?: boolean;
  mode?: "user" | "sync";
}): DuplicateDecisions {
  const {
    enrichmentMatches: classifiedEnrichments,
    plainDuplicates,
    pendingDuplicates,
    resolutions = [],
    acknowledgeDuplicates = false,
    mode = "user",
  } = args;

  const enrichmentMatches = [...classifiedEnrichments];
  const enrichmentIndices = new Set(enrichmentMatches.map((m) => m.draftIndex));
  const plainByIndex = new Map(plainDuplicates.map((d) => [d.draftIndex, d] as const));
  const pendingByIndex = new Map(pendingDuplicates.map((d) => [d.draftIndex, d] as const));
  const skippedIndices = new Set<number>();

  // "enrich" — fold the draft into the matched transaction instead of writing it.
  for (const { draftIndex, action } of resolutions) {
    if (action !== "enrich") continue;
    const matched =
      plainByIndex.get(draftIndex)?.matched ?? pendingByIndex.get(draftIndex)?.matched;
    if (!matched) continue;
    enrichmentMatches.push({ draftIndex, matchedTransactionId: matched.id });
    enrichmentIndices.add(draftIndex);
    plainByIndex.delete(draftIndex);
    pendingByIndex.delete(draftIndex);
  }

  // "skip" — the draft is neither written nor folded into anything.
  for (const { draftIndex, action } of resolutions) {
    if (action !== "skip") continue;
    const at = enrichmentMatches.findIndex((m) => m.draftIndex === draftIndex);
    if (at >= 0) enrichmentMatches.splice(at, 1);
    enrichmentIndices.delete(draftIndex);
    plainByIndex.delete(draftIndex);
    pendingByIndex.delete(draftIndex);
    skippedIndices.add(draftIndex);
  }

  // "import" — write the draft even though it duplicates an existing trade.
  for (const { draftIndex, action } of resolutions) {
    if (action !== "import") continue;
    plainByIndex.delete(draftIndex);
    pendingByIndex.delete(draftIndex);
  }

  // A plain duplicate can be cleared by the blanket acknowledgement (historical
  // behaviour). A pending duplicate can not: it needs an explicit per-row decision.
  const plainDuplicateCount = plainByIndex.size;
  let blockedPlain = acknowledgeDuplicates ? [] : [...plainByIndex.values()];

  // Sync mode: merge a cross-source match into the confirmed row it matches instead of
  // blocking — a broker sync has no review screen, and merging the broker's data into
  // the existing trade is strictly better than writing the trade a second time.
  if (mode === "sync") {
    for (const match of blockedPlain) {
      enrichmentMatches.push({
        draftIndex: match.draftIndex,
        matchedTransactionId: match.matched.id,
      });
      enrichmentIndices.add(match.draftIndex);
    }
    blockedPlain = [];
  }

  const blockedPending = [...pendingByIndex.values()];

  return {
    enrichmentMatches,
    skippedIndices,
    blockedPlain,
    blockedPending,
    counts: {
      duplicates: plainDuplicateCount,
      pending: blockedPending.length,
      enrichments: enrichmentMatches.length,
      skipped: skippedIndices.size,
    },
  };
}
