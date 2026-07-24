"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, GripVertical, Lock, Pencil } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type {
  AdminProvider,
  AdminProvidersResponse,
  ApiClient,
  ProviderCredentialInput,
} from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SortableAdminRow } from "@/components/sortable-utils";
import { CredentialEditorPanel } from "@/components/admin/credential-editor-panel";
import { UsageCell } from "./admin-providers-form/usage-cell";
import { canEditCredential, ProviderKeySubline } from "./admin-providers-form/credential-cell";

/** The slice of the API client this form needs (injectable for tests). */
export type AdminProvidersClient = Pick<
  ApiClient,
  "updateAdminProviders" | "setAdminProviderCredential" | "clearAdminProviderCredential"
>;

// Order + enabled flags only — id/label/configured are immutable here.
const signature = (rows: AdminProvider[]) =>
  rows.map((r) => `${r.id}:${r.enabled ? 1 : 0}`).join(",");

export function AdminProvidersForm({
  client,
  initialProviders,
  encryptionEnabled,
  onSuccess,
}: {
  client: AdminProvidersClient;
  initialProviders: AdminProvider[];
  encryptionEnabled: boolean;
  onSuccess?: () => void;
}) {
  const t = useTranslations("Admin");
  const [rows, setRows] = useState(initialProviders);
  // Baseline the form diffs against; advances on a successful save.
  const [baseline, setBaseline] = useState(initialProviders);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  // Mobile-only: dragging is gated behind an explicit "Reorder" mode (design: `edit` state
  // + the trailing grip only rendered `isMobile && edit`). Desktop drags anytime via the
  // always-visible lead grip — no mode needed there.
  const [reorderMode, setReorderMode] = useState(false);
  // Which row's inline credential editor is expanded (design: `credEdit`) — at most one
  // at a time, across the whole list.
  const [editingId, setEditingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dirty = signature(rows) !== signature(baseline);

  function refreshFromResponse(res: AdminProvidersResponse) {
    setRows(res.providers);
    setBaseline(res.providers);
    onSuccess?.();
  }

  function toggle(id: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    setSaved(false);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRows((rs) => {
        const oldIndex = rs.findIndex((r) => r.id === active.id);
        const newIndex = rs.findIndex((r) => r.id === over.id);
        return arrayMove(rs, oldIndex, newIndex);
      });
      setSaved(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      const updated = await client.updateAdminProviders(
        rows.map((r, i) => ({ id: r.id, enabled: r.enabled, priority: i + 1 })),
      );
      refreshFromResponse(updated);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetCredential(id: string, body: ProviderCredentialInput) {
    const updated = await client.setAdminProviderCredential(id, body);
    refreshFromResponse(updated);
  }

  async function handleClearCredential(id: string) {
    const updated = await client.clearAdminProviderCredential(id);
    refreshFromResponse(updated);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          {t("updateError")}
        </div>
      )}

      {encryptionEnabled && (
        <div className="flex items-center gap-2.5 rounded-[14px] border border-primary/20 bg-primary/10 px-3.5 py-2.5">
          <Lock className="size-[17px] shrink-0 text-primary" strokeWidth={2} />
          <p className="text-xs">
            <span className="font-semibold text-foreground">{t("credentialEncrypted")}</span>{" "}
            <span className="font-medium text-text-2">· {t("credentialEncryptedMeta")}</span>
          </p>
        </div>
      )}

      <div className="flex items-center justify-end md:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => setReorderMode((v) => !v)}>
          {reorderMode ? t("done") : t("reorder")}
        </Button>
      </div>

      <DndContext
        id="admin-providers"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="overflow-hidden rounded-[20px] bg-card shadow-card">
            {rows.map((p, i) => {
              const editable = canEditCredential(p, encryptionEnabled);
              const editing = editingId === p.id;
              return (
                <SortableAdminRow
                  key={p.id}
                  id={p.id}
                  className={i > 0 ? "border-t border-line" : ""}
                >
                  {({ handleProps }) => (
                    <>
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        {/* Lead grip — desktop only, always draggable there. */}
                        <button
                          type="button"
                          {...handleProps.attrs}
                          {...handleProps.listeners}
                          aria-label={t("dragHandle")}
                          className="hidden shrink-0 cursor-grab items-center justify-center text-text-3 hover:text-text-2 active:cursor-grabbing md:flex"
                        >
                          <GripVertical className="size-4" />
                        </button>
                        {/* Trailing grip — mobile, only while in reorder mode. */}
                        {reorderMode && (
                          <button
                            type="button"
                            {...handleProps.attrs}
                            {...handleProps.listeners}
                            aria-label={t("dragHandle")}
                            className="flex size-8 shrink-0 cursor-grab items-center justify-center text-text-3 active:cursor-grabbing md:hidden"
                          >
                            <GripVertical className="size-5" />
                          </button>
                        )}
                        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-background text-[11px] font-extrabold text-text-2">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">{p.label}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            <ProviderKeySubline
                              provider={p}
                              encryptionEnabled={encryptionEnabled}
                              usage={<UsageCell usage={p.usage} />}
                              t={t}
                            />
                          </div>
                        </div>
                        {p.configured && (
                          <Switch
                            checked={p.enabled}
                            onCheckedChange={() => toggle(p.id)}
                            aria-label={p.enabled ? t("enabled") : t("disabled")}
                          />
                        )}
                        {/* Suppressed (not just disabled) without encryption — matches the
                            old dialog-based cell, which offered no editor trigger at all
                            in that case; `ProviderKeySubline` already explains why. */}
                        {!p.configured && editable && (
                          <button
                            type="button"
                            onClick={() => setEditingId(p.id)}
                            className="shrink-0 whitespace-nowrap rounded-[9px] bg-primary/10 px-2.5 py-1.5 text-[11px] font-bold text-primary"
                          >
                            {t("credentialSet")}
                          </button>
                        )}
                        {editable && p.configured && (
                          <button
                            type="button"
                            onClick={() => setEditingId(editing ? null : p.id)}
                            aria-label={t("editCredential")}
                            className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-background text-text-2 hover:text-foreground"
                          >
                            <Pencil className="size-[15px]" />
                          </button>
                        )}
                      </div>
                      {editing && (
                        <CredentialEditorPanel
                          label={p.label}
                          hasCredential={p.hasKey}
                          onSave={(apiKey) => handleSetCredential(p.id, { apiKey })}
                          onClear={() => handleClearCredential(p.id)}
                          onClose={() => setEditingId(null)}
                        />
                      )}
                    </>
                  )}
                </SortableAdminRow>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !dirty}>
          {busy && <Spinner size="sm" />}
          {busy ? t("saving") : t("save")}
        </Button>
        {saved && !dirty && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="size-4" />
            {t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}
