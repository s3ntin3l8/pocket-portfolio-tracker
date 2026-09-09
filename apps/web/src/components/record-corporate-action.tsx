"use client";

import { RecordCorporateActionForm } from "@/components/record-corporate-action-form";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import type { PickablePortfolio } from "@/components/portfolio-picker";

/** Real-client wrapper: records the action, then returns to holdings. */
export function RecordCorporateAction({
  portfolioId,
  portfolios,
  onPortfolioChange,
  stickyFooter = false,
  isAdmin = false,
}: {
  /** Required when type is "merger" (mergers are portfolio-scoped). */
  portfolioId?: string;
  /** Available portfolios for the merger portfolio picker. */
  portfolios?: PickablePortfolio[];
  /** Called when the user picks a different portfolio in the merger picker. Required
   *  when `portfolios` is supplied — see `RecordCorporateActionForm`. */
  onPortfolioChange: (id: string) => void;
  /** See `AddTransactionForm` — sheet contexts only. */
  stickyFooter?: boolean;
  isAdmin?: boolean;
}) {
  const api = useApiClient();
  const router = useRouter();
  return (
    <RecordCorporateActionForm
      client={api}
      portfolioId={portfolioId}
      portfolios={portfolios}
      onPortfolioChange={onPortfolioChange}
      stickyFooter={stickyFooter}
      isAdmin={isAdmin}
      onSuccess={() => {
        router.push("/holdings");
        router.refresh();
      }}
    />
  );
}
