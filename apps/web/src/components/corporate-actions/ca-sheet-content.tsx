"use client";

import { Check, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  return (
    <SheetContent side="bottom" className="px-4 pb-8">
      <SheetHeader>
        <SheetTitle>{tc("edit")}</SheetTitle>
      </SheetHeader>
      {ca && (
        <div className="space-y-4 pt-4">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{tc("type")}</span>
            <Select
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
              aria-label={tc("ratio")}
              inputMode="decimal"
              value={ratio}
              onChange={(e) => onRatioChange(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{tc("exDate")}</span>
            <DatePicker
              label={tc("exDate")}
              value={exDate}
              onChange={(e) => onExDateChange(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button disabled={busy} onClick={() => onSave(ca.id)}>
              {busy ? <Spinner size="sm" /> : <Check className="size-4" />}
              {tc("save")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              <X className="size-4" />
              {tc("cancel")}
            </Button>
          </div>
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
    </SheetContent>
  );
}
