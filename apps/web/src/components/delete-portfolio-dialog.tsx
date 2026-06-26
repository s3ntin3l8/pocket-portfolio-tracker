"use client";

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EditablePortfolio } from "@/components/portfolio-form-dialog";
import { Button } from "@/components/ui/button";
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
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { deletePortfolioWithCleanup } from "@/lib/delete-portfolio";

/**
 * A confirm modal for deleting a portfolio. States how many transactions will be removed
 * (plus a note that related documents/loans/history cascade too) before the user commits.
 * `trigger` is rendered as the dialog's trigger — pass a DropdownMenuItem (with
 * `onSelect={(e) => e.preventDefault()}`) to embed it inside an overflow menu without the
 * menu unmounting the dialog.
 */
export function DeletePortfolioDialog({
  portfolio,
  trigger,
  onDeleted,
}: {
  portfolio: EditablePortfolio;
  trigger: React.ReactNode;
  onDeleted?: () => void;
}) {
  const t = useTranslations("PortfolioForm");
  const api = useApiClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function onOpenChange(next: boolean) {
    if (!next) {
      setError(false);
      setBusy(false);
    }
    setOpen(next);
  }

  async function handleDelete() {
    setBusy(true);
    setError(false);
    try {
      await deletePortfolioWithCleanup(api, router, portfolio.id);
      setOpen(false);
      onDeleted?.();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("deleteTitle", { name: portfolio.name })}</DialogTitle>
          <DialogDescription>
            {t("deleteWarning", { count: portfolio.transactionCount ?? 0 })}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{t("deleteRelatedNote")}</p>

        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            {t("error")}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={busy}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("confirmDelete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
