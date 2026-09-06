"use client";

import { useTranslations } from "next-intl";
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
 * Edit a transaction. Overlay chrome migration (#625): a single DialogContent tree —
 * full-screen page on mobile, a centered size="lg" (880px) card at md:+ — replacing a
 * useMediaQuery("(min-width: 860px)") branch between a hand-rolled desktop Dialog and a
 * bottom Sheet.
 *
 * `AddTransactionForm` itself still takes an `isDesktop` prop (its own two-column
 * layout + Summary rail vs. mobile's single column is a genuinely different internal
 * layout, not overlay chrome, and out of scope here) — but it's now read reactively off
 * the same media query and passed to the ONE mounted `AddTransactionForm` instance,
 * instead of picking which of two separate component trees to mount. Resizing across
 * the breakpoint now just re-renders its layout; before, it would unmount the whole
 * form (and every typed field) along with the outer chrome.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* footer={true}: AddTransactionForm's own SubmitButton self-portals via
          useSheetFooter() — this just wires up the slot, no static content of its own
          (no separate Cancel button; the header's close X/back-chevron already covers
          that, matching the old desktop chrome). */}
      <DialogContent size="lg" mobileHeader={{ title: tm("editTitle") }} footer={true}>
        <div className="p-5 md:p-[26px]">
          <DialogTitle className="hidden text-[19px] font-extrabold md:mb-3 md:block">
            {tm("editTitle")}
          </DialogTitle>
          {tx && (
            <AddTransactionForm
              client={api}
              portfolioId={tx.portfolioId}
              transactionId={tx.id}
              initial={toInitial(tx)}
              stickyFooter
              isDesktop={isDesktop}
              onSuccess={handleSuccess}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
