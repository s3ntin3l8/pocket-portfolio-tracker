"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PortfolioPicker, type PickablePortfolio } from "@/components/portfolio-picker";
import { AddTransaction } from "@/components/add-transaction";
import type { AddTransactionInitial } from "@/components/add-transaction-form";
import { RecordCorporateAction } from "@/components/record-corporate-action";

export type NewEntryTab = "transaction" | "corporate-action";

/**
 * Unifies the manual-entry forms behind one tabbed page. A transaction is
 * portfolio-scoped; a corporate action (split, bonus, rights, or merger) is either
 * instrument-global or portfolio-scoped depending on the type — handled within a
 * single form component.
 *
 * The portfolio picker makes the destination explicit. Shared by the transaction
 * tab, absent from the corporate-action tab when the type is not a merger.
 */
const ALL_TABS: NewEntryTab[] = ["transaction", "corporate-action"];

export function NewEntryTabs({
  portfolios,
  initialPortfolioId,
  initialTransaction,
  stickyFooter = false,
  isAdmin = false,
  isDesktop = false,
  value,
  onValueChange,
  hideTabList = false,
  visibleTabs = ALL_TABS,
}: {
  portfolios: PickablePortfolio[];
  initialPortfolioId: string;
  /** Prefill for the Transaction tab (e.g. a harvest-suggestion sell draft from
   *  `/tax`, threaded in via `?harvestInstrument=<id>`). */
  initialTransaction?: AddTransactionInitial;
  /** Pin each tab's submit button in a sticky footer (#472) — the sheet caller
   *  (`add-transaction-menu.tsx`) turns this on; the full `/transactions/new` page leaves
   *  it off (a bottom-pinned bar there would sit under the fixed bottom-nav). */
  stickyFooter?: boolean;
  isAdmin?: boolean;
  /** Desktop modal shell — see `AddTransactionForm`'s `isDesktop`. Only threaded to
   *  `AddTransaction` (its two-column layout) now — `RecordCorporateAction`
   *  gets its submit button's chrome from `useSheetFooterChrome()` instead. */
  isDesktop?: boolean;
  /** Controlled active tab — the caller owns the state, so changing it on an already-
   *  mounted tree (deep-link prefill, manual reset, …) takes effect without remount. */
  value: NewEntryTab;
  onValueChange: (tab: NewEntryTab) => void;
  /** Suppress the in-body segmented tab control — the desktop rail's "Instrument event"
   *  destination hosts corporate-action as a standalone form instead. */
  hideTabList?: boolean;
  /** Restrict which tabs are mounted — e.g. the desktop rail's "Add transaction" destination
   *  only ever shows the transaction tab. Defaults to both tabs. */
  visibleTabs?: NewEntryTab[];
}) {
  const tt = useTranslations("Manage.tx");
  const tca = useTranslations("CorpAction");
  const [portfolioId, setPortfolioId] = useState(initialPortfolioId);
  const activePortfolio = portfolios.find((p) => p.id === portfolioId) ?? portfolios[0];

  const picker =
    portfolios.length > 1 ? (
      <div className="space-y-1.5">
        <span className="block text-sm font-medium">{tt("portfolioPicker")}</span>
        <PortfolioPicker
          portfolios={portfolios}
          value={portfolioId}
          onChange={setPortfolioId}
          ariaLabel={tt("portfolioPicker")}
          triggerClassName="w-full sm:max-w-xs"
        />
      </div>
    ) : null;

  return (
    <Tabs value={value} onValueChange={(v: string) => onValueChange(v as NewEntryTab)}>
      {!hideTabList && (
        <TabsList className="flex w-full">
          {visibleTabs.includes("transaction") && (
            <TabsTrigger value="transaction" className="flex-1">
              {tt("tabTransaction")}
            </TabsTrigger>
          )}
          {visibleTabs.includes("corporate-action") && (
            <TabsTrigger value="corporate-action" className="flex-1">
              {tca("link")}
            </TabsTrigger>
          )}
        </TabsList>
      )}
      {visibleTabs.includes("transaction") && (
        <TabsContent value="transaction">
          <AddTransaction
            portfolioId={portfolioId}
            portfolio={activePortfolio}
            portfolioPicker={picker}
            initial={initialTransaction}
            stickyFooter={stickyFooter}
            isDesktop={isDesktop}
          />
        </TabsContent>
      )}
      {visibleTabs.includes("corporate-action") && (
        <TabsContent value="corporate-action" className="space-y-4">
          <RecordCorporateAction
            portfolioId={portfolioId}
            portfolios={portfolios}
            onPortfolioChange={setPortfolioId}
            stickyFooter={stickyFooter}
            isAdmin={isAdmin}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
