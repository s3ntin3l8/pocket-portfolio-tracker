"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAP_ACTIONS } from "./types";
import { Field } from "./edit-dialog";
import type { ImportDraft } from "./types";

export interface MapDialogProps {
  open: boolean;
  onClose: () => void;
  form: ImportDraft | null;
  onChange: (patch: Partial<ImportDraft>) => void;
  onSave: () => void;
}

export function MapDialog({ open, onClose, form, onChange, onSave }: MapDialogProps) {
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
          <DialogTitle>{t("review.issues.mapTitle")}</DialogTitle>
        </DialogHeader>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("review.columns.action")}>
              <Select value={form.action} onChange={(e) => onChange({ action: e.target.value })}>
                {MAP_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("fields.name")}>
              <Input value={form.name ?? ""} onChange={(e) => onChange({ name: e.target.value })} />
            </Field>
            <Field label="ISIN">
              <Input value={form.isin ?? ""} onChange={(e) => onChange({ isin: e.target.value })} />
            </Field>
            <Field label="WKN">
              <Input value={form.wkn ?? ""} onChange={(e) => onChange({ wkn: e.target.value })} />
            </Field>
            <Field label={t("fields.executedAt")}>
              <DatePicker
                label={t("fields.executedAt")}
                value={form.executedAt.slice(0, 10)}
                onChange={(e) => onChange({ executedAt: e.target.value })}
              />
            </Field>
            <Field label={t("fields.quantity")}>
              <Input
                value={form.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
              />
            </Field>
            <Field label={t("fields.price")}>
              <Input value={form.price} onChange={(e) => onChange({ price: e.target.value })} />
            </Field>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onSave}>{t("review.issues.mapSave")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
