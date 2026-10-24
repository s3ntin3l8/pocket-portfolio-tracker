"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportReview } from "@/components/import-review";
import { DuplicateConflictBanner } from "@/components/duplicate-conflict-banner";
import { PortfolioPicker } from "@/components/portfolio-picker";
import { Label } from "@/components/ui/label";
import {
  withUid,
  type ImportDraft,
  type ImportIssue,
  type ImportTargetPortfolio,
  type ReviewDraft,
} from "@/components/import-flow/types";
import type { DuplicateAnnotation, LikelyDuplicate } from "@portfolio/api-client";
import { useApiClient } from "@/lib/api";
import { useImportConfirm } from "@/lib/use-import-confirm";
import { useTimeout } from "@/lib/use-timeout";
import { classifyImportError } from "@/lib/import-errors";
import { useRouter } from "@/i18n/navigation";

/**
 * Review and confirm an already-staged draft import (e.g. a Trade Republic sync, or a
 * parse the user navigated away from). Reuses the same `ImportReview` table as the live
 * upload flow, seeded with the draft's transactions loaded server-side. Confirming writes
 * the transactions; discarding marks the import discarded. Both return to /transactions.
 */
export function DraftReviewClient({
  importId,
  initialPortfolioId,
  drafts: initial,
  issues: initialIssues = [],
  portfolios = [],
}: {
  importId: string;
  /** Portfolio stored on the import record (pytr always has one; CSV/screenshot may not). */
  initialPortfolioId: string | null;
  drafts: ImportDraft[];
  issues?: ImportIssue[];
  portfolios?: ImportTargetPortfolio[];
}) {
  const t = useTranslations("ImportHistory");
  const ti = useTranslations("Import");
  const api = useApiClient();
  const router = useRouter();

  const [drafts, setDrafts] = useState<ReviewDraft[]>(() =>
    initial.map((d, i) => withUid(d, importId, i)),
  );
  const [issues, setIssues] = useState<ImportIssue[]>(initialIssues);

  // Transient "N transactions imported" banner after a partial confirm.
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const hideImported = useTimeout();

  // Portfolio selection: use the stored portfolioId if available, otherwise default to
  // the first portfolio in the list. The picker is only shown when there are multiple
  // portfolios and the import doesn't already have a portfolio bound.
  const [portfolioId, setPortfolioId] = useState<string>(
    initialPortfolioId ?? portfolios[0]?.id ?? "",
  );

  function backToImport() {
    router.push("/transactions");
    router.refresh(); // surface the new transactions (and updated history) elsewhere
  }

  const {
    error,
    duplicateConflict,
    accountMismatch,
    pendingSubset,
    pendingAcknowledgeMismatch,
    confirm,
    enrichOneDuplicate,
    resolveDuplicate,
  } = useImportConfirm({
    importId,
    drafts,
    setDrafts,
    contracts: [],
    getPortfolioId: () => portfolioId || undefined,
    client: api,
    onFullSuccess: () => backToImport(),
    onPartialSuccess: (count) => {
      setImportedCount(count);
      hideImported.schedule(() => setImportedCount(null), 5000);
      router.refresh();
    },
    getErrorMessage: (err) =>
      classifyImportError(err).reason === "transferCostBasisRequired"
        ? ti("errors.transferCostBasisRequired")
        : t("reviewError"),
  });

  // The advisory duplicate annotations are computed against a portfolio — and the
  // portfolio the user ends up confirming into may not be the one the upload was
  // annotated for. Re-fetch them for the effective target so the badges (and the
  // "confirm all" filter that uses them) always describe the portfolio the import
  // actually goes into.
  useEffect(() => {
    if (!portfolioId) return;
    let cancelled = false;
    void api
      .checkImportDuplicates(importId, portfolioId)
      .then(({ annotations }) => {
        if (!cancelled) applyAnnotations(annotations);
      })
      .catch(() => {
        // Advisory only — the confirm gate is authoritative.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importId, portfolioId]);

  function updateDraft(uid: string, patch: Partial<ImportDraft>) {
    setDrafts((ds) => ds.map((d) => (d.uid === uid ? { ...d, ...patch } : d)));
  }

  function applyAnnotations(annotations: DuplicateAnnotation[]) {
    const byServerIdx = new Map(annotations.map((a) => [a.draftIndex, a]));
    setDrafts((ds) =>
      ds.map((d) => {
        const ann = byServerIdx.get(d._serverIdx);
        const likelyDuplicate: LikelyDuplicate | null = ann
          ? {
              kind: ann.kind,
              source: ann.matchedSource,
              executedAt: ann.matchedExecutedAt,
              matchedTransactionId: ann.matchedTransactionId,
            }
          : null;
        return { ...d, likelyDuplicate };
      }),
    );
  }

  // Promote a mapped issue into a draft, then drop it from the issues list.
  function mapIssue(eventId: string, draft: ImportDraft) {
    setDrafts((ds) => [...ds, withUid(draft, importId, -1)]);
    setIssues((is) => is.filter((i) => i.eventId !== eventId));
  }

  function removeDraft(uid: string) {
    setDrafts((ds) => ds.filter((d) => d.uid !== uid));
  }

  function removeMany(uids: string[]) {
    const set = new Set(uids);
    setDrafts((ds) => ds.filter((d) => !set.has(d.uid)));
  }

  async function discard() {
    try {
      await api.discardImport(importId);
      backToImport();
    } catch {
      // The error is surfaced by the shared hook state if confirm was in flight;
      // for discard we rely on the global error boundary (discard failure is rare).
    }
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {importedCount !== null && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success-strong"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          {t("importedBanner", { count: importedCount })}
        </div>
      )}
      {/* Account-mismatch warning (#197): file looks like it belongs to another portfolio. */}
      {accountMismatch && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warn-strong"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span className="flex-1">
            {accountMismatch.kind === "other_portfolio"
              ? ti("accountMismatch.otherPortfolio", {
                  portfolio: accountMismatch.matchedName ?? "",
                  account: accountMismatch.detected,
                })
              : ti("accountMismatch.noMatch", { account: accountMismatch.detected })}
          </span>
          <Button size="sm" variant="outline" onClick={() => void confirm(undefined, true)}>
            {ti("accountMismatch.importAnyway")}
          </Button>
        </div>
      )}
      {duplicateConflict && (
        <DuplicateConflictBanner
          conflict={duplicateConflict}
          onEnrich={(d) => void enrichOneDuplicate(d)}
          onResolve={(d, action) => void resolveDuplicate(d, action)}
          onImportAnyway={() =>
            void confirm(
              pendingSubset.current.map((d) => d.uid),
              pendingAcknowledgeMismatch.current,
              true,
            )
          }
        />
      )}
      {portfolios.length > 1 && (
        <div className="space-y-1.5">
          <Label>{ti("targetPortfolio")}</Label>
          <PortfolioPicker
            portfolios={portfolios}
            value={portfolioId}
            onChange={(pid) => {
              setPortfolioId(pid);
              void api
                .checkImportDuplicates(importId, pid)
                .then(({ annotations }) => applyAnnotations(annotations))
                .catch(() => {});
            }}
            ariaLabel={ti("targetPortfolio")}
            triggerClassName="w-full"
          />
        </div>
      )}
      <ImportReview
        drafts={drafts}
        issues={issues}
        onMapIssue={mapIssue}
        onUpdate={updateDraft}
        onRemove={removeDraft}
        onRemoveMany={removeMany}
        onConfirm={confirm}
        onDiscard={discard}
      />
    </div>
  );
}
