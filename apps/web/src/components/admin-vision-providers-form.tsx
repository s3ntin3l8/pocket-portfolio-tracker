"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Check, GripVertical, Pencil } from "lucide-react";
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
  AdminVisionProvider,
  AdminVisionProvidersResponse,
  ProviderCredentialInput,
} from "@portfolio/api-client";
import type { AdminVisionProvidersClient } from "./admin-vision-providers/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SortableAdminRow } from "@/components/sortable-utils";
import { CredentialEditorPanel } from "@/components/admin/credential-editor-panel";
import {
  canEditVisionCredential,
  hasVisionCredential,
  isUrlProvider,
  VisionKeySubline,
} from "./admin-vision-providers/vision-credential-cell";

const signature = (rows: AdminVisionProvider[]) =>
  rows.map((r) => `${r.id}:${r.enabled ? 1 : 0}`).join(",");

export function AdminVisionProvidersForm({
  client,
  initialProviders,
  encryptionEnabled,
  onSuccess,
}: {
  client: AdminVisionProvidersClient;
  initialProviders: AdminVisionProvider[];
  encryptionEnabled: boolean;
  onSuccess?: () => void;
}) {
  const t = useTranslations("Admin");
  const [rows, setRows] = useState(initialProviders);
  const [baseline, setBaseline] = useState(initialProviders);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const dirty = signature(rows) !== signature(baseline);

  function refreshFromResponse(res: AdminVisionProvidersResponse) {
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
      const updated = await client.updateAdminVisionProviders(
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
    const updated = await client.setAdminVisionProviderCredential(id, body);
    refreshFromResponse(updated);
  }

  async function handleClearCredential(id: string) {
    const updated = await client.clearAdminVisionProviderCredential(id);
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

      <div className="flex items-center justify-end md:hidden">
        <Button type="button" variant="outline" size="sm" onClick={() => setReorderMode((v) => !v)}>
          {reorderMode ? t("done") : t("reorder")}
        </Button>
      </div>

      <DndContext
        id="admin-vision-providers"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="overflow-hidden rounded-[20px] bg-card shadow-card">
            {rows.map((p, i) => {
              const editable = canEditVisionCredential(encryptionEnabled);
              const editing = editingId === p.id;
              const isUrl = isUrlProvider(p);
              return (
                <SortableAdminRow
                  key={p.id}
                  id={p.id}
                  className={i > 0 ? "border-t border-line" : ""}
                >
                  {({ handleProps }) => (
                    <>
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <button
                          type="button"
                          {...handleProps.attrs}
                          {...handleProps.listeners}
                          aria-label={t("dragHandle")}
                          className="hidden shrink-0 cursor-grab items-center justify-center text-text-3 hover:text-text-2 active:cursor-grabbing md:flex"
                        >
                          <GripVertical className="size-4" />
                        </button>
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
                            <VisionKeySubline
                              provider={p}
                              encryptionEnabled={encryptionEnabled}
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
                          isUrl={isUrl}
                          hasCredential={hasVisionCredential(p)}
                          onSave={(value) =>
                            handleSetCredential(
                              p.id,
                              isUrl ? { urlOverride: value } : { apiKey: value },
                            )
                          }
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
