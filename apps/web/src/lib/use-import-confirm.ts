"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  accountMismatchFromError,
  duplicatesFromError,
  type DuplicateConflict,
  type DuplicateMatch,
  type DuplicateResolutionAction,
  type AccountMismatch,
} from "@portfolio/api-client";
import { stripUid, type ImportDraft, type ReviewDraft } from "@/components/import-flow/types";
import { useApiClient } from "@/lib/api";

// ---------------------------------------------------------------------------
// useImportConfirm — shared single-import confirm / enrich state machine
//
// Extracted from the overlap between import-flow.tsx (single-group path) and
// draft-review-client.tsx. Manages error / duplicate-conflict / account-mismatch
// state plus pendingSubset tracking so the 409 banner can resolve draftIndex.
//
// Both flows share confirm() + enrichOneDuplicate(); they differ in what they
// do on success (navigate away vs. stay and show a transient banner) — those
// are delegated to the caller via onFullSuccess / onPartialSuccess callbacks.
//
// The multi-group fan-out in import-flow.tsx is NOT covered by this hook
// (see the multi-group block in confirm() in import-flow.tsx).
// ---------------------------------------------------------------------------

export interface UseImportConfirmParams {
  /** The import record this hook confirms against (single-import only). */
  importId: string;
  /** Current draft list. Must be the same reference the caller renders from. */
  drafts: ReviewDraft[];
  setDrafts: Dispatch<SetStateAction<ReviewDraft[]>>;
  /** Gold contracts (pass [] when not applicable). */
  contracts: ImportDraft[];
  /** Returns the currently selected portfolio id (may be undefined). */
  getPortfolioId: () => string | undefined;
  client: ReturnType<typeof useApiClient>;
  /**
   * Called just before the confirmImport network call (e.g. to set a loading
   * step). Optional — import-flow sets step→"parsing"; draft-review-client
   * doesn't need this.
   */
  onBeforeConfirm?: () => void;
  /**
   * Called after a successful full confirm (all non-duplicate drafts sent and
   * accepted). Receives the confirmed count. Import-flow calls setStep("done");
   * draft-review-client navigates back.
   */
  onFullSuccess: (confirmedCount: number) => void;
  /**
   * Called after a PARTIAL confirm success (subset.length < drafts.length AND
   * caller opted in to partial mode). When provided the hook drops the confirmed
   * rows from `drafts` and calls this with the count; when absent every success
   * is treated as full.
   */
  onPartialSuccess?: (confirmedCount: number) => void;
  /**
   * Called after an error is set (e.g. to roll back a loading step).
   * Optional — import-flow calls setStep("review").
   */
  onAfterError?: () => void;
  /**
   * Maps a caught error to a user-visible string. Defaults to a generic message
   * (callers can provide the importSkipReason-based message used in import-flow).
   */
  getErrorMessage?: (err: unknown) => string;
}

export interface UseImportConfirmResult {
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  duplicateConflict: DuplicateConflict | null;
  setDuplicateConflict: Dispatch<SetStateAction<DuplicateConflict | null>>;
  accountMismatch: AccountMismatch | null;
  setAccountMismatch: Dispatch<SetStateAction<AccountMismatch | null>>;
  /** The ordered subset sent to the last confirm — used by enrichOneDuplicate. */
  pendingSubset: React.MutableRefObject<ReviewDraft[]>;
  /** The acknowledge-mismatch flag from the last confirm call — used when re-confirming after enrich. */
  pendingAcknowledgeMismatch: React.MutableRefObject<boolean>;
  /**
   * Per-row decisions taken since the last confirm, held by the draft's **identity** (its
   * uid) and translated to the index the server receives — a recorded index would refer to
   * the wrong draft as soon as one resolution changes the array that is sent.
   */
  pendingResolutions: React.MutableRefObject<
    Array<{ uid: string; action: DuplicateResolutionAction }>
  >;
  confirm: (
    uids?: string[],
    acknowledgeMismatch?: boolean,
    acknowledgeDup?: boolean,
  ) => Promise<void>;
  enrichOneDuplicate: (d: DuplicateMatch) => Promise<void>;
  /** Resolve one duplicate by dropping it (neither written nor folded into anything). */
  skipOneDuplicate: (d: DuplicateMatch) => Promise<void>;
  /** Resolve one duplicate with an explicit per-row disposition. */
  resolveDuplicate: (d: DuplicateMatch, action: DuplicateResolutionAction) => Promise<void>;
}

const DEFAULT_ERROR = "Something went wrong. Please try again.";

export function useImportConfirm({
  importId,
  drafts,
  setDrafts,
  contracts,
  getPortfolioId,
  client,
  onBeforeConfirm,
  onFullSuccess,
  onPartialSuccess,
  onAfterError,
  getErrorMessage,
}: UseImportConfirmParams): UseImportConfirmResult {
  const [error, setError] = useState<string | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateConflict | null>(null);
  const [accountMismatch, setAccountMismatch] = useState<AccountMismatch | null>(null);
  const pendingSubset = useRef<ReviewDraft[]>([]);
  const pendingAcknowledgeMismatch = useRef(false);
  const pendingResolutions = useRef<Array<{ uid: string; action: DuplicateResolutionAction }>>([]);

  /**
   * Find the draft a conflict refers to.
   *
   * The server identifies a conflict by its stable `externalId` first and by the index into
   * the array it received as a fallback. The index is only advisory: the server may have
   * filtered the submitted array before classifying, so the two can disagree. Identity wins
   * whenever it is available.
   */
  function resolveDraft(d: DuplicateMatch): { draft: ReviewDraft; index: number } | null {
    const subset = pendingSubset.current;
    if (d.externalId) {
      const byId = subset.findIndex((dr) => {
        const ext = (dr as { externalId?: string | null }).externalId;
        return ext != null && ext === d.externalId;
      });
      if (byId >= 0) return { draft: subset[byId], index: byId };
    }
    const byIndex = subset[d.draftIndex];
    return byIndex ? { draft: byIndex, index: d.draftIndex } : null;
  }

  async function confirm(uids?: string[], acknowledgeMismatch = false, acknowledgeDup = false) {
    setError(null);
    pendingAcknowledgeMismatch.current = acknowledgeMismatch;

    // "Confirm all" excludes plain-duplicate rows (they need explicit user choice), but
    // includes enrichment rows (auto-applied server-side). An explicit uid list includes
    // exactly what the user selected.
    const subset =
      uids && uids.length
        ? drafts.filter((d) => uids.includes(d.uid))
        : drafts.filter((d) => d.likelyDuplicate?.kind !== "duplicate");
    pendingSubset.current = subset;

    // The resolutions are held by the draft's *identity* (its uid), and translated to the
    // index the server will see — the index into the array we are sending right now.
    //
    // Recording an index when the decision was taken would be wrong: resolving one
    // duplicate re-sends a *different* array (the resolved draft is gone), so every
    // recorded index after that point refers to the wrong draft — a skip would land on the
    // next draft and silently lose it.
    const resolutions = pendingResolutions.current
      .map((r) => {
        const draftIndex = subset.findIndex((d) => d.uid === r.uid);
        return draftIndex >= 0 ? { draftIndex, action: r.action } : null;
      })
      .filter((r): r is { draftIndex: number; action: DuplicateResolutionAction } => r !== null);

    onBeforeConfirm?.();

    try {
      const { confirmed } = await client.confirmImport(
        importId,
        subset.map(stripUid) as unknown as Parameters<typeof client.confirmImport>[1],
        contracts as unknown as Parameters<typeof client.confirmImport>[2],
        getPortfolioId(),
        acknowledgeMismatch,
        acknowledgeDup,
        resolutions,
      );
      setDuplicateConflict(null);
      setAccountMismatch(null);
      pendingResolutions.current = [];

      // Partial-confirm mode: when enabled and the subset < the full draft list,
      // stay on the review page, drop the confirmed rows, and show a success notice.
      const isPartial = onPartialSuccess != null && subset.length < drafts.length;
      if (isPartial) {
        const confirmedUids = new Set(subset.map((d) => d.uid));
        setDrafts((ds) => ds.filter((d) => !confirmedUids.has(d.uid)));
        onPartialSuccess(confirmed);
      } else {
        onFullSuccess(confirmed);
      }
    } catch (err) {
      const mismatch = accountMismatchFromError(err);
      const duplicates = duplicatesFromError(err);
      if (mismatch) {
        setAccountMismatch(mismatch);
      } else if (duplicates) {
        setDuplicateConflict(duplicates);
      } else {
        setError(getErrorMessage ? getErrorMessage(err) : DEFAULT_ERROR);
      }
      onAfterError?.();
    }
  }

  async function enrichOneDuplicate(d: DuplicateMatch) {
    const found = resolveDraft(d);
    if (!found) return;
    const { draft, index } = found;
    try {
      await client.enrichImport(
        importId,
        [
          {
            draft: stripUid(draft) as unknown as Parameters<
              typeof client.enrichImport
            >[1][0]["draft"],
            targetTransactionId: d.matchedTransactionId,
          },
        ],
        getPortfolioId(),
      );
      // Drop the enriched draft from the pending set; clear the duplicate conflict;
      // re-confirm the remaining drafts (with the same mismatch-acknowledge as before).
      const remainingUids = pendingSubset.current.filter((_, i) => i !== index).map((dr) => dr.uid);
      setDuplicateConflict(null);
      setDrafts((ds) => ds.filter((dr) => dr.uid !== draft.uid));
      if (remainingUids.length > 0) {
        void confirm(remainingUids, pendingAcknowledgeMismatch.current, false);
      }
    } catch (err) {
      setError(getErrorMessage ? getErrorMessage(err) : DEFAULT_ERROR);
      onAfterError?.();
    }
  }

  /**
   * Drop one duplicate: it is neither written nor folded into the matched transaction.
   *
   * This is the resolution the server could not express before — "import the new trades,
   * skip the ones I already have" — and it is the safe default for a duplicate the user
   * did not recognise as the same trade.
   */
  async function skipOneDuplicate(d: DuplicateMatch) {
    const found = resolveDraft(d);
    if (!found) return;
    const { draft, index } = found;

    // Record the decision by the draft's identity — the index is derived later, against the
    // array the server actually receives.
    pendingResolutions.current = [
      ...pendingResolutions.current.filter((r) => r.uid !== draft.uid),
      { uid: draft.uid, action: "skip" },
    ];

    // Drop it from the pending set and re-confirm the rest.
    const remainingUids = pendingSubset.current.filter((_, i) => i !== index).map((dr) => dr.uid);
    setDuplicateConflict(null);
    setDrafts((ds) => ds.filter((dr) => dr.uid !== draft.uid));
    if (remainingUids.length > 0) {
      await confirm(remainingUids, pendingAcknowledgeMismatch.current, false);
    }
  }

  /** Resolve a duplicate with an explicit per-row disposition. */
  async function resolveDuplicate(d: DuplicateMatch, action: DuplicateResolutionAction) {
    if (action === "enrich") {
      await enrichOneDuplicate(d);
      return;
    }
    if (action === "skip") {
      await skipOneDuplicate(d);
      return;
    }
    // "import" — write it as its own transaction. The server needs the explicit
    // disposition; the blanket acknowledgement is not used for it.
    const found = resolveDraft(d);
    if (!found) return;
    const { draft } = found;
    pendingResolutions.current = [
      ...pendingResolutions.current.filter((r) => r.uid !== draft.uid),
      { uid: draft.uid, action: "import" },
    ];
    setDuplicateConflict(null);
    await confirm(
      pendingSubset.current.map((dr) => dr.uid),
      pendingAcknowledgeMismatch.current,
      false,
    );
  }

  return {
    error,
    setError,
    duplicateConflict,
    setDuplicateConflict,
    accountMismatch,
    setAccountMismatch,
    pendingSubset,
    pendingAcknowledgeMismatch,
    pendingResolutions,
    confirm,
    enrichOneDuplicate,
    skipOneDuplicate,
    resolveDuplicate,
  };
}
