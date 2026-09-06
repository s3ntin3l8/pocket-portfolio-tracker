"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: "destructive" | "default";
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = "destructive",
  busy,
  onConfirm,
  children,
}: ConfirmActionDialogProps) {
  const t = useTranslations("Common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A confirm is a blocking yes/no, not a task — it stays a small centered card at
          every width instead of taking over the mobile screen. */}
      <DialogContent fullScreenOnMobile={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner className="mr-2" />}
            {confirmLabel ?? t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
