"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { HoldingValuation } from "@portfolio/api-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoldingsTable } from "@/components/holdings-table";
import { TableToolbar, TOOLBAR_FILTERS, ToolbarSearch } from "@/components/table-toolbar";
import { CHIP_BASE, CHIP_INACTIVE } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The "Positions" section on Holdings — the asset-class tabs + table, plus (unlike the
 * server-rendered page around it) a client-local search over the already-loaded rows.
 *
 * Search is deliberately local `useState`, not the URL-param + debounce pattern Activity
 * uses: Activity is server-paginated, so its search has to round-trip; Holdings already
 * loads every row server-side (`page.tsx`'s `loadHoldings`), so a client filter is both
 * simpler and instant. There is no `onSearchChange` callback prop for the same reason —
 * this panel is rendered from a *server* page, so no function can cross that boundary;
 * the query lives and dies inside this component.
 */
export function PositionsPanel({
  rows,
  currency,
  cash,
  classTabs,
  actions,
}: {
  rows: HoldingValuation[];
  currency: string;
  /** Per-currency cash balances — pass `undefined` when the portfolio doesn't track cash
   *  (the page already resolves this via `hasCash`; this component doesn't need to know
   *  why, only whether there's a balance to show and filter). */
  cash?: Record<string, string>;
  /** Server-computed visible asset-class tabs (incl. "all"). Stays a prop rather than
   *  being recomputed here: `page.tsx` also needs it for its loading/empty states, and —
   *  more importantly — whether the "cash" tab shows depends on `cashTracked`, which
   *  isn't derivable from `cash` alone (a portfolio can hold cash balances without cash
   *  being counted in its boundary). Recomputing here could show a Cash tab that
   *  shouldn't exist. */
  classTabs: readonly string[];
  /** Export CSV button — rendered right of the search input. Exports the full `rows`
   *  regardless of the active search/tab (see the comment above `exportRows` below). */
  actions?: React.ReactNode;
}) {
  const t = useTranslations("Holdings");
  const tc = useTranslations("AssetClass");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  // Matches what the table actually renders (holdings-table.tsx): symbol and
  // displayName ?? name. No ISIN — InstrumentMeta doesn't carry one.
  const searched = useMemo(() => {
    if (!q) return rows;
    return rows.filter((h) => {
      const symbol = h.instrument?.symbol?.toLowerCase() ?? "";
      const name = (h.instrument?.displayName ?? h.instrument?.name ?? "").toLowerCase();
      return symbol.includes(q) || name.includes(q);
    });
  }, [rows, q]);

  // The cash pseudo-row is filtered, not dropped, when a query is active — dropping it
  // would make typing "cash" hide the Cash row instead of isolating it. Matches against
  // the currency code and the translated "Cash" label.
  const cashLabel = t("cash").toLowerCase();
  const filteredCash = useMemo(() => {
    if (!cash) return undefined;
    if (!q) return cash;
    const kept = Object.fromEntries(
      Object.entries(cash).filter(
        ([ccy]) => ccy.toLowerCase().includes(q) || cashLabel.includes(q),
      ),
    );
    return Object.keys(kept).length > 0 ? kept : undefined;
  }, [cash, q, cashLabel]);

  return (
    <div className="space-y-3">
      <Tabs defaultValue="all">
        <TableToolbar
          key="toolbar"
          filters={
            // Holdings has no mobile filter Sheet to hold the tabs, so — unlike
            // Activity's TOOLBAR_FILTERS_DESKTOP_ONLY — chips stay visible (and
            // horizontally scrollable) at every width.
            <div className={TOOLBAR_FILTERS}>
              <TabsList className="h-auto gap-2 rounded-full border-0 bg-transparent p-0">
                {classTabs.map((key) => (
                  <TabsTrigger
                    key={key}
                    value={key}
                    // Radix drives the active state via `data-state`, a CSS attribute
                    // selector rather than a JS boolean — so unlike the other three
                    // toolbars' `cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_INACTIVE)`,
                    // the base/inactive spec is shared from ui/table.tsx but the
                    // active-state override still needs its own literal
                    // `data-[state=active]:` variants (Tailwind can't derive those from
                    // a runtime CHIP_ACTIVE string).
                    className={cn(
                      CHIP_BASE,
                      CHIP_INACTIVE,
                      "data-[state=active]:border-transparent data-[state=active]:bg-pill data-[state=active]:font-bold data-[state=active]:text-white data-[state=active]:shadow-none",
                    )}
                  >
                    {key === "all" ? t("all") : tc(key)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          }
          search={
            <ToolbarSearch
              value={query}
              onChange={setQuery}
              placeholder={t("searchPlaceholder")}
              clearLabel={t("searchClear")}
            />
          }
          actions={actions}
        />

        {classTabs.map((key) => {
          const classRows =
            key === "all" ? searched : searched.filter((h) => h.instrument?.assetClass === key);
          const tabCash = key === "all" || key === "cash" ? filteredCash : undefined;
          const noResults = classRows.length === 0 && !tabCash;

          return (
            <TabsContent key={key} value={key}>
              <div className="overflow-hidden rounded-2xl bg-card shadow-card">
                {noResults ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>
                ) : (
                  <HoldingsTable rows={classRows} currency={currency} cash={tabCash} />
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
