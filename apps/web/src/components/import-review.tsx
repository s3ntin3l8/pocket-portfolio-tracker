"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LOW_CONFIDENCE_THRESHOLD } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTableSort } from "@/lib/table-sort";
import type { ImportDraft, ImportIssue } from "@/components/import-flow/types";
import type { ReviewDraft } from "./import-review/types";
import { REVIEW_COLS } from "./import-review/types";
import type { ImportReviewProps } from "./import-review/types";
import { EnrichmentNotice, DuplicateNotice, IssuesBanner } from "./import-review/notices";
import { FilterBar } from "./import-review/filter-bar";
import { BulkToolbar } from "./import-review/bulk-toolbar";
import { ImportTable } from "./import-review/table";
import { MobileView } from "./import-review/mobile";
import { EditDialog } from "./import-review/edit-dialog";
import { MapDialog } from "./import-review/map-dialog";

export type { ImportReviewGroup, ImportReviewProps } from "./import-review/types";

/**
 * The review step of the import flow: a compact, filterable, bulk-selectable list of
 * draft transactions. Renders a dense table on desktop and stacked cards on mobile;
 * editing happens in a focused dialog. Every action keys off the draft's stable `uid`,
 * so selection and edits stay correct while filtering hides rows or removals reindex
 * the underlying array.
 */
export function ImportReview({
  drafts,
  onUpdate,
  onRemove,
  onRemoveMany,
  onConfirm,
  onDiscard,
  issues = [],
  onMapIssue,
  groups,
  portfolios,
  portfolioByImport,
  onPortfolioChange,
  issuesByImport,
  isSubmitting = false,
}: ImportReviewProps) {
  const isGrouped = (groups?.length ?? 0) > 1;
  const t = useTranslations("Import");

  const { sortKey, sortDir, toggle: toggleSort, sort } = useTableSort<ReviewDraft>(REVIEW_COLS);

  const allIssues = useMemo(() => {
    if (issuesByImport) {
      return Array.from(issuesByImport.values()).flat();
    }
    return issues;
  }, [issues, issuesByImport]);

  const attention = allIssues.filter((i) => i.severity === "attention" && i.eventId);
  const ignorable = allIssues.filter((i) => !(i.severity === "attention" && i.eventId));

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggleCollapse(importId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(importId)) next.delete(importId);
      else next.add(importId);
      return next;
    });
  }

  const [mapping, setMapping] = useState<ImportIssue | null>(null);
  const [mapForm, setMapForm] = useState<ImportDraft | null>(null);

  function openMap(issue: ImportIssue) {
    const raw = issue.raw ?? {};
    const amount = raw.amount != null ? Math.abs(raw.amount) : 0;
    const defaultAction = issue.eventType === "SSP_CORPORATE_ACTION_INSTRUMENT" ? "bonus" : "buy";
    const defaultQty = raw.shares != null && raw.shares > 0 ? String(raw.shares) : "0";
    setMapping(issue);
    setMapForm({
      assetClass: "equity",
      action: defaultAction,
      isin: raw.isin ?? null,
      name: raw.name ?? issue.eventType ?? "",
      quantity: defaultQty,
      unit: "shares",
      price: defaultAction === "bonus" ? "0" : String(amount),
      fees: "0",
      currency: raw.currency ?? "EUR",
      executedAt: (raw.executedAt ?? new Date().toISOString()).slice(0, 10),
      confidence: 1,
      externalId: issue.eventId ?? null,
    });
  }

  function saveMap() {
    if (mapping?.eventId && mapForm && onMapIssue) onMapIssue(mapping.eventId, mapForm);
    setMapping(null);
    setMapForm(null);
  }

  function closeMap() {
    setMapping(null);
    setMapForm(null);
  }

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [pending, setPending] = useState<"confirm" | "confirmSelected" | "discard" | null>(null);
  const busy = pending !== null || isSubmitting;

  async function runConfirm(action: "confirm" | "confirmSelected", uids?: string[]) {
    setPending(action);
    try {
      await onConfirm(uids);
      clearFilters();
      setSelected(new Set());
    } finally {
      setPending(null);
    }
  }

  async function runDiscard() {
    setPending("discard");
    try {
      await onDiscard();
    } finally {
      setPending(null);
    }
  }

  const [assetClassFilter, setAssetClassFilter] = useState<Set<string>>(new Set());
  const [actionFilter, setActionFilter] = useState<Set<string>>(new Set());
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [query, setQuery] = useState("");

  function toggleFilter(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const assetClasses = useMemo(
    () => [...new Set(drafts.map((d) => d.assetClass).filter(Boolean))].sort(),
    [drafts],
  );
  const actions = useMemo(
    () => [...new Set(drafts.map((d) => d.action).filter(Boolean))].sort(),
    [drafts],
  );

  const filtersActive =
    assetClassFilter.size > 0 || actionFilter.size > 0 || needsReviewOnly || query.trim() !== "";

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = drafts.filter((d) => {
      if (assetClassFilter.size && !assetClassFilter.has(d.assetClass)) return false;
      if (actionFilter.size && !actionFilter.has(d.action)) return false;
      if (needsReviewOnly && d.confidence >= LOW_CONFIDENCE_THRESHOLD) return false;
      if (q && !(d.name ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    return sort(filtered);
  }, [drafts, assetClassFilter, actionFilter, needsReviewOnly, query, sort]);

  const visibleIssueRows = useMemo(() => {
    if (assetClassFilter.size > 0 || actionFilter.size > 0) return [];
    const q = query.trim().toLowerCase();
    return attention.filter(
      (i) => !q || (i.raw?.name ?? i.eventType ?? "").toLowerCase().includes(q),
    );
  }, [attention, assetClassFilter, actionFilter, query]);

  const selectedIds = useMemo(
    () => drafts.filter((d) => selected.has(d.uid)).map((d) => d.uid),
    [drafts, selected],
  );
  const allVisibleSelected = view.length > 0 && view.every((d) => selected.has(d.uid));

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) for (const d of view) next.delete(d.uid);
      else for (const d of view) next.add(d.uid);
      return next;
    });
  }

  function handleRemove(uid: string) {
    onRemove(uid);
    setSelected((prev) => {
      if (!prev.has(uid)) return prev;
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }

  function removeSelected() {
    onRemoveMany(selectedIds);
    setSelected(new Set());
    setConfirming(false);
  }

  function clearFilters() {
    setAssetClassFilter(new Set());
    setActionFilter(new Set());
    setNeedsReviewOnly(false);
    setQuery("");
  }

  const editingDraft = drafts.find((d) => d.uid === editingUid) ?? null;

  const duplicateCount = useMemo(
    () => drafts.filter((d) => d.likelyDuplicate?.kind === "duplicate").length,
    [drafts],
  );
  const enrichmentCount = useMemo(
    () => drafts.filter((d) => d.likelyDuplicate?.kind === "enrichment").length,
    [drafts],
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("draftCount", { count: drafts.length })} — {t("reviewHint")}
      </p>

      <EnrichmentNotice count={enrichmentCount} />
      <DuplicateNotice count={duplicateCount} />
      <IssuesBanner attention={attention} ignorable={ignorable} />

      <FilterBar
        assetClasses={assetClasses}
        assetClassFilter={assetClassFilter}
        onToggleAssetClass={(v) => toggleFilter(setAssetClassFilter, v)}
        actions={actions}
        actionFilter={actionFilter}
        onToggleAction={(v) => toggleFilter(setActionFilter, v)}
        needsReviewOnly={needsReviewOnly}
        onNeedsReviewChange={setNeedsReviewOnly}
        query={query}
        onQueryChange={setQuery}
        filtersActive={filtersActive}
        viewLength={view.length}
        draftsLength={drafts.length}
        onClearFilters={clearFilters}
      />

      <BulkToolbar
        selectedCount={selectedIds.length}
        busy={busy}
        pending={pending}
        onConfirmSelected={() => runConfirm("confirmSelected", selectedIds)}
        confirming={confirming}
        onRequestConfirm={() => setConfirming(true)}
        onCancelConfirm={() => setConfirming(false)}
        onRemoveConfirm={removeSelected}
      />

      <ImportTable
        drafts={drafts}
        view={view}
        visibleIssueRows={visibleIssueRows}
        isGrouped={isGrouped}
        groups={groups}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        portfolios={portfolios}
        portfolioByImport={portfolioByImport}
        onPortfolioChange={onPortfolioChange}
        issuesByImport={issuesByImport}
        selected={selected}
        onToggle={toggle}
        allVisibleSelected={allVisibleSelected}
        onToggleAll={toggleAll}
        sortKey={sortKey}
        sortDir={sortDir}
        onToggleSort={toggleSort}
        onEdit={setEditingUid}
        onRemove={handleRemove}
        onMapIssue={openMap}
        assetClassFilter={assetClassFilter}
        actionFilter={actionFilter}
        query={query}
      />

      <MobileView
        view={view}
        draftsLength={drafts.length}
        isGrouped={isGrouped}
        groups={groups}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        portfolios={portfolios}
        portfolioByImport={portfolioByImport}
        onPortfolioChange={onPortfolioChange}
        selected={selected}
        onToggle={toggle}
        onEdit={setEditingUid}
        onRemove={handleRemove}
      />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={runDiscard} disabled={busy}>
          {pending === "discard" && <Spinner size="sm" />}
          {t("discard")}
        </Button>
        <Button onClick={() => runConfirm("confirm")} disabled={busy || drafts.length === 0}>
          {pending === "confirm" && <Spinner size="sm" />}
          {t("confirm")}
        </Button>
      </div>

      <EditDialog
        open={editingUid !== null}
        onClose={() => setEditingUid(null)}
        draft={editingDraft}
        onUpdate={onUpdate}
      />

      <MapDialog
        open={mapping !== null}
        onClose={closeMap}
        form={mapForm}
        onChange={(patch) => setMapForm((prev) => (prev ? { ...prev, ...patch } : prev))}
        onSave={saveMap}
      />
    </div>
  );
}
