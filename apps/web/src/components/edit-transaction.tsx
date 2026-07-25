"use client";

import { AddTransactionForm, type AddTransactionInitial } from "@/components/add-transaction-form";
import { useApiClient } from "@/lib/api";
import { useMediaQuery } from "@/lib/use-media-query";
import { useRouter } from "@/i18n/navigation";

/**
 * Real-client wrapper for the standalone `/transactions/:id/edit` route: updates the
 * transaction, then returns to the list. Unlike `EditTransactionSheet` this is a real
 * page (its own header/back-link, from `edit/page.tsx`), not an overlay, so on a wide
 * viewport it just passes `isDesktop` through for `AddTransactionForm`'s two-column
 * layout + Summary rail — no Dialog wrapper needed, the page itself is already the chrome.
 */
export function EditTransaction({
  portfolioId,
  txId,
  initial,
}: {
  portfolioId: string;
  txId: string;
  initial: AddTransactionInitial;
}) {
  const api = useApiClient();
  const router = useRouter();
  const isDesktop = useMediaQuery("(min-width: 860px)");
  return (
    <AddTransactionForm
      client={api}
      portfolioId={portfolioId}
      transactionId={txId}
      initial={initial}
      isDesktop={isDesktop}
      onSuccess={() => {
        router.push("/transactions");
        router.refresh();
      }}
    />
  );
}
