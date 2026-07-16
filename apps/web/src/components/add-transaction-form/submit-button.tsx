"use client";

import { createPortal } from "react-dom";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  busy: boolean;
  isEdit: boolean;
  formId: string;
  stickyFooter: boolean;
  footerEl: HTMLElement | null;
  t: (key: string) => string;
}

export function SubmitButton({
  busy,
  isEdit,
  formId,
  stickyFooter,
  footerEl,
  t,
}: SubmitButtonProps) {
  const footerPortal = Boolean(stickyFooter && footerEl);

  const button = (
    <Button
      type="submit"
      form={formId}
      disabled={busy}
      className="h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
    >
      {busy && <Spinner size="sm" />}
      {busy ? t("submitting") : isEdit ? t("save") : t("submit")}
    </Button>
  );

  if (footerPortal && footerEl) {
    return createPortal(
      <div className="border-t border-border bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {button}
      </div>,
      footerEl,
    );
  }

  return (
    <div
      className={cn(
        stickyFooter &&
          "sticky bottom-0 -mx-5 border-t border-border bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] scroll-mb-24",
      )}
    >
      {button}
    </div>
  );
}
