"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAP_ACTIONS } from "./types";
import type { ImportDraft, ReviewDraft } from "./types";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export interface EditDialogProps {
  open: boolean;
  onClose: () => void;
  draft: ReviewDraft | null;
  onUpdate: (uid: string, patch: Partial<ImportDraft>) => void;
}

export function EditDialog({ open, onClose, draft, onUpdate }: EditDialogProps) {
  const t = useTranslations("Import");
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("review.edit.title")}</DialogTitle>
        </DialogHeader>
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("review.columns.action")}>
              <Select
                value={draft.action}
                onChange={(e) => onUpdate(draft.uid, { action: e.target.value })}
              >
                {MAP_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fields.currency")}>
              <Input
                value={draft.currency}
                onChange={(e) => onUpdate(draft.uid, { currency: e.target.value })}
              />
            </Field>
            <Field label={t("fields.name")}>
              <Input
                value={draft.name ?? ""}
                onChange={(e) => onUpdate(draft.uid, { name: e.target.value })}
              />
            </Field>
            <Field label="ISIN">
              <Input
                value={draft.isin ?? ""}
                onChange={(e) => onUpdate(draft.uid, { isin: e.target.value || null })}
              />
            </Field>
            <Field label="WKN">
              <Input
                value={draft.wkn ?? ""}
                onChange={(e) => onUpdate(draft.uid, { wkn: e.target.value || null })}
              />
            </Field>
            <Field label={t("fields.executedAt")}>
              <DatePicker
                label={t("fields.executedAt")}
                value={draft.executedAt.slice(0, 10)}
                onChange={(e) => onUpdate(draft.uid, { executedAt: e.target.value })}
              />
            </Field>
            <Field label={t("fields.quantity")}>
              <Input
                value={draft.quantity}
                onChange={(e) => onUpdate(draft.uid, { quantity: e.target.value })}
              />
            </Field>
            <Field label={t("fields.price")}>
              <Input
                value={draft.price}
                onChange={(e) => onUpdate(draft.uid, { price: e.target.value })}
              />
            </Field>
            <Field label={t("fields.fees")}>
              <Input
                value={draft.fees ?? ""}
                onChange={(e) => onUpdate(draft.uid, { fees: e.target.value || null })}
              />
            </Field>
            <Field label={t("fields.tax")}>
              <Input
                value={draft.tax ?? ""}
                onChange={(e) => onUpdate(draft.uid, { tax: e.target.value || null })}
              />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>
            <X className="size-4" />
            {t("review.edit.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
