"use client";

import { createPortal } from "react-dom";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useSheetFooterChrome } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface SubmitButtonProps {
  busy: boolean;
  isEdit: boolean;
  formId: string;
  stickyFooter: boolean;
  footerEl: HTMLElement | null;
  t: (key: string) => string;
  /** Compact-vs-full-width button styling only — independent of `useSheetFooterChrome()`
   *  below, which separately decides whether the button portals bare or wrapped in its
   *  own border/background. The two happen to agree at every current call site (a
   *  styled desktop host is also where `isDesktop` is true) but nothing enforces that;
   *  don't assume one implies the other. */
  isDesktop?: boolean;
}

export function SubmitButton({
  busy,
  isEdit,
  formId,
  stickyFooter,
  footerEl,
  t,
  isDesktop = false,
}: SubmitButtonProps) {
  const hasFooterChrome = useSheetFooterChrome();
  const footerPortal = Boolean(stickyFooter && footerEl);

  const button = (
    <Button
      type="submit"
      form={formId}
      disabled={busy}
      className={
        isDesktop
          ? "h-auto rounded-[13px] px-[26px] py-[13px] text-[14px] font-bold"
          : "h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
      }
    >
      {busy && <Spinner size="sm" />}
      {busy ? t("submitting") : isEdit ? t("save") : t("submit")}
    </Button>
  );

  if (footerPortal && footerEl) {
    if (hasFooterChrome) {
      // The host's footer bar already supplies border-t/bg/padding/justify-end layout —
      // portal just the bare button into it (a Cancel button, if any, sits alongside it
      // there). Keyed on the host (see useSheetFooterChrome), not `isDesktop` — that's
      // this form's own internal two-column-vs-one-column layout, a different axis.
      return createPortal(button, footerEl);
    }
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
