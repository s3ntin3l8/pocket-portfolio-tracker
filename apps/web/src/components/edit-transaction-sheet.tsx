"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AddTransactionForm, type AddTransactionInitial } from "@/components/add-transaction-form";
import { useApiClient } from "@/lib/api";
import { useMediaQuery } from "@/lib/use-media-query";
import { useRouter } from "@/i18n/navigation";
import type { TxRow } from "@/components/transactions-table";

/** Build the edit form's prefill from a table row (which carries the full transaction at
 *  runtime, even though `TxRow` only types a subset). */
function toInitial(tx: TxRow): AddTransactionInitial {
  return {
    type: tx.type,
    instrumentId: tx.instrumentId ?? null,
    instrument: tx.instrument
      ? {
          symbol: tx.instrument.symbol ?? "",
          name: tx.instrument.name ?? "",
          assetClass: tx.instrument.assetClass ?? "equity",
          unit: tx.instrument.unit ?? "shares",
        }
      : null,
    quantity: tx.quantity,
    price: tx.price,
    fees: tx.fees,
    tax: tx.tax,
    fxRate: tx.fxRate,
    perShare: tx.perShare ?? null,
    shares: tx.shares ?? null,
    nativeCurrency: tx.nativeCurrency ?? null,
    grossNative: tx.grossNative ?? null,
    description: tx.description ?? null,
    tags: tx.tags ?? null,
    currency: tx.currency,
    executedAt: tx.executedAt,
    sources: tx.sources,
    hasFullTaxDetail: tx.hasFullTaxDetail,
    kind: tx.kind ?? null,
    source: tx.source,
    externalId: tx.externalId,
  };
}

/**
 * Edit a transaction. Mobile: a bottom sheet (reference: editing reuses the manual-entry
 * sheet titled "Edit transaction"), instead of navigating to the standalone edit page.
 * Desktop (v2 design, ≥860px — the same breakpoint the Add flow uses): a centered 860px
 * modal instead, with `AddTransactionForm`'s two-column layout + Summary rail. Unlike Add,
 * this doesn't reuse `add-transaction-menu/desktop-shell.tsx`'s `DesktopShell` — that's
 * sized for a multi-step, multi-destination flow with its own nav rail, which Edit isn't;
 * this instead pattern-matches `transaction-detail-sheet.tsx`'s own lighter hand-rolled
 * desktop `Dialog` (a plain sticky header + scrollable body, no separate footer chrome).
 * On save it closes and refreshes the list in place.
 */
export function EditTransactionSheet({
  tx,
  open,
  onOpenChange,
  onSaved,
}: {
  tx: TxRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const api = useApiClient();
  const router = useRouter();
  const tm = useTranslations("Manage.tx");
  const isDesktop = useMediaQuery("(min-width: 860px)");

  const handleSuccess = () => {
    onOpenChange(false);
    onSaved?.();
    router.refresh();
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          hideClose
          className="flex w-[calc(100%-4rem)] max-w-[860px] flex-col gap-0 overflow-hidden rounded-[22px] border-0 bg-background p-0 shadow-[0_30px_80px_rgba(0,0,0,.4)] max-h-[calc(100vh-64px)]"
        >
          <div className="sticky top-0 z-[2] flex items-center gap-3 border-b border-border bg-background px-[26px] py-[18px]">
            <DialogTitle className="flex-1 text-[19px] font-extrabold">
              {tm("editTitle")}
            </DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-card text-foreground shadow-[0_1px_2px_rgba(15,27,20,.08)] transition-colors hover:bg-secondary"
            >
              <X className="size-[17px]" strokeWidth={2.2} />
            </button>
          </div>
          <div className="overflow-y-auto px-[26px] py-5">
            {tx && (
              <AddTransactionForm
                client={api}
                portfolioId={tx.portfolioId}
                transactionId={tx.id}
                initial={toInitial(tx)}
                isDesktop
                onSuccess={handleSuccess}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    // handleOnly: restrict drag-to-close to the handle — the form scrolls within
    // SheetContent and vaul's at-top scroll gating must not intercept it (#472).
    <Sheet open={open} onOpenChange={onOpenChange} handleOnly>
      <SheetContent side="bottom" className="p-0">
        <SheetHeader className="px-5 pb-1 pt-1">
          <SheetTitle className="text-[19px]">{tm("editTitle")}</SheetTitle>
        </SheetHeader>
        {/* Note: no nested overflow-y-auto here — SheetContent is the single scroll
            container. Nested scroll containers can confuse vaul's at-top drag gating
            and cause the form scroll vs. drag-to-close conflict (#472). */}
        <div className="px-5 pb-7 pt-3">
          {tx && (
            <AddTransactionForm
              client={api}
              portfolioId={tx.portfolioId}
              transactionId={tx.id}
              initial={toInitial(tx)}
              stickyFooter
              onSuccess={handleSuccess}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
