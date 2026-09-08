"use client";

import { RecordCorporateActionForm } from "@/components/record-corporate-action-form";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

/** Real-client wrapper: records the action, then returns to holdings. */
export function RecordCorporateAction({
  portfolioId,
  stickyFooter = false,
  isAdmin = false,
}: {
  /** Required when type is "merger" (mergers are portfolio-scoped). */
  portfolioId?: string;
  /** See `AddTransactionForm` — sheet contexts only. */
  stickyFooter?: boolean;
  isAdmin?: boolean;
} = {}) {
  const api = useApiClient();
  const router = useRouter();
  return (
    <RecordCorporateActionForm
      client={api}
      portfolioId={portfolioId}
      stickyFooter={stickyFooter}
      isAdmin={isAdmin}
      onSuccess={() => {
        router.push("/holdings");
        router.refresh();
      }}
    />
  );
}
