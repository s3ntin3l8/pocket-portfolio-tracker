"use client";

import { useId } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { CorporateAction } from "@portfolio/api-client";

interface CaSheetContentProps {
  ca: CorporateAction | null;
  type: string;
  onTypeChange: (v: string) => void;
  ratio: string;
  onRatioChange: (v: string) => void;
  exDate: string;
  onExDateChange: (v: string) => void;
  busy: boolean;
  confirmDelete: boolean;
  onConfirmDeleteChange: (v: boolean) => void;
  onClose: () => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  TYPES: readonly string[];
  tc: (key: string) => string;
  tt: (key: string) => string;
}

/**
 * Mobile-only editor (the desktop table edits inline in the row instead — see
 * `corporate-actions-manager.tsx` — so this never renders there, but DialogContent
 * still handles the resize-safety case: opening on a phone, then resizing/rotating
 * across md, reflows into the centered card rather than staying Sheet-shaped forever).
 * Overlay chrome migration (#625): was a bottom Sheet with no desktop-aware behavior
 * at all.
 */
export function CaSheetContent({
  ca,
  type,
  onTypeChange,
  ratio,
  onRatioChange,
  exDate,
  onExDateChange,
  busy,
  confirmDelete,
  onConfirmDeleteChange,
  onClose,
  onSave,
  onDelete,
  TYPES,
  tc,
  tt,
}: CaSheetContentProps) {
  const uid = useId();

  return (
    <DialogContent
      size="sm"
      mobileHeader={{ title: tc("edit") }}
      footer={
        ca && (
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              <X className="size-4" />
              {tc("cancel")}
            </Button>
            <Button disabled={busy} onClick={() => onSave(ca.id)}>
              {busy ? <Spinner size="sm" /> : <Check className="size-4" />}
              {tc("save")}
            </Button>
          </>
        )
      }
    >
      <div className="p-4 md:p-6">
        <DialogTitle className="hidden text-lg font-semibold md:mb-3 md:block">
          {tc("edit")}
        </DialogTitle>
        {ca && (
          <div className="space-y-4">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{tc("type")}</span>
              <Select
                id={`${uid}-type`}
                aria-label={tc("type")}
                value={type}
                onChange={(e) => onTypeChange(e.target.value)}
              >
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {tt(ty)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{tc("ratio")}</span>
              <Input
                id={`${uid}-ratio`}
                aria-label={tc("ratio")}
                inputMode="decimal"
                value={ratio}
                onChange={(e) => onRatioChange(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{tc("exDate")}</span>
              <DatePicker
                id={`${uid}-ex-date`}
                label={tc("exDate")}
                value={exDate}
                onChange={(e) => onExDateChange(e.target.value)}
              />
            </div>

            {/* Delete is a rare, deliberate action — stays in-flow, same split as the
                portfolio/holder/instrument dialogs. */}
            <div className="border-t border-border pt-4">
              {confirmDelete ? (
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => onDelete(ca.id)}>
                    {busy && <Spinner size="xs" />}
                    {tc("delete")}
                  </Button>
                  <Button variant="ghost" onClick={() => onConfirmDeleteChange(false)}>
                    {tc("cancel")}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => onConfirmDeleteChange(true)}
                >
                  <Trash2 className="size-4" />
                  {tc("delete")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  );
}
