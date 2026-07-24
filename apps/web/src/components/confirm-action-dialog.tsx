"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * A reusable confirmation dialog modelled after {@link DeleteHolderDialog}.
 * Supports an optional "type to confirm" flow for destructive actions.
 *
 * When `requiresTyping` is true the user must type the word "Delete" before the
 * confirm button is enabled. The `entityLabel` is shown prominently in the
 * description so the user knows exactly what they're acting on.
 *
 * Two ways to open it:
 * - **Uncontrolled** (`trigger` only): the dialog owns its own open state and renders
 *   `trigger` as the `DialogTrigger` — the original, self-contained usage.
 * - **Controlled** (`open`/`onOpenChange`, no `trigger`): the caller owns open state
 *   instead — needed when the thing that opens it isn't a plain button but a
 *   `DropdownMenuItem` (e.g. the admin users kebab menu), where nesting a
 *   `DialogTrigger` inside a menu item fights Radix's own focus/dismiss handling.
 */
export function ConfirmActionDialog({
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  title,
  description,
  entityLabel,
  confirmLabel,
  confirmVariant = "destructive",
  requiresTyping = false,
  onConfirm,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  entityLabel: string;
  confirmLabel: string;
  confirmVariant?: "destructive" | "default";
  requiresTyping?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("Admin");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [typed, setTyped] = useState("");

  function onOpenChange(next: boolean) {
    if (!next) {
      setError(false);
      setBusy(false);
      setTyped("");
    }
    (controlledOnOpenChange ?? setInternalOpen)(next);
  }

  async function handleConfirm() {
    setBusy(true);
    setError(false);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  const canConfirm = requiresTyping ? typed === "Delete" : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {entityLabel && (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground">
            {entityLabel}
          </p>
        )}

        {requiresTyping && (
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">
              {t("confirmActionTypeToConfirm")}
            </label>
            <Input
              placeholder={t("confirmActionInputPlaceholder")}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            {t("updateError")}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={busy}>
              {t("confirmActionCancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={busy || !canConfirm}
          >
            {busy && <Spinner size="sm" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
