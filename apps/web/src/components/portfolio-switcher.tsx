"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronDown, Layers, Users } from "lucide-react";
import type { Portfolio, AccountHolder } from "@portfolio/api-client";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { BrokerageIcon } from "@/components/brokerage-icon";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  SELECTED_PORTFOLIO_COOKIE,
  SCOPE_PARAM,
  formatScopeParam,
  parseScopeParam,
  scopeToCookieValue,
  type ScopeSelection,
} from "@/lib/portfolio-selection";

/** Params that belong to the previous scope's view and must not survive a scope change:
 *  the Holdings drill-in override and list pagination. */
export const SCOPE_RESET_PARAMS = ["portfolio", "page"];

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Global scope selector shown in the app shell header. Three levels:
 * 1. "All portfolios" — the cross-portfolio aggregate (default).
 * 2. Account holders — an aggregate of all portfolios owned by that holder
 *    (only shown when a holder owns ≥2 portfolios; single-portfolio holders are
 *    equivalent to the portfolio view already covered by section 3).
 * 3. Individual portfolios.
 *
 * The URL is the source of truth: selecting an item pushes `?scope=` (a history entry,
 * so back/forward restores the previous scope) and also writes the `pf` cookie, which
 * remains the default for scope-less URLs. Other search params are preserved.
 * - Portfolio: `?scope=p:<portfolioId>` / `pf=<portfolioId>`
 * - Holder aggregate: `?scope=h:<holderId>` / `pf=holder:<holderId>`
 * - All: `?scope=all` / `pf=all`
 */
export function PortfolioSwitcher({
  portfolios,
  holders = [],
  selectedId,
  selectedHolderId = null,
}: {
  portfolios: Pick<Portfolio, "id" | "name" | "brokerage" | "accountHolder">[];
  /** Holders that qualify for the filter (≥2 portfolios each). Passed from layout. */
  holders?: Pick<AccountHolder, "id" | "name">[];
  selectedId: string | null;
  selectedHolderId?: string | null;
}) {
  const t = useTranslations("PortfolioSwitcher");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A scope in the URL wins over the server-provided selection (the layout isn't
  // re-rendered by a search-param navigation, so its props can lag the URL).
  const urlScope = parseScopeParam(searchParams.get(SCOPE_PARAM));
  let scopedId = selectedId;
  let scopedHolderId = selectedHolderId;
  if (urlScope) {
    scopedId =
      urlScope.kind === "portfolio" && portfolios.some((p) => p.id === urlScope.portfolioId)
        ? urlScope.portfolioId
        : null;
    scopedHolderId =
      urlScope.kind === "holder" && holders.some((h) => h.id === urlScope.holderId)
        ? urlScope.holderId
        : null;
  }

  // When the user drills into a portfolio from /portfolios (card click), we land on
  // /holdings?portfolio=<id> without touching the scope. Reflect that transient
  // override in the switcher so the label is accurate. Precedence: the drill-in override
  // beats `?scope=` for the label because it is what the positions table shows; the other
  // cards on that page still follow the scope. Picking anything here drops the override.
  const overrideParam = pathname === "/holdings" ? searchParams.get("portfolio") : null;
  const overrideActive = !!overrideParam && portfolios.some((p) => p.id === overrideParam);
  const effectiveSelectedId = overrideActive ? overrideParam : scopedId;
  const effectiveHolderId = overrideActive ? null : scopedHolderId;

  if (portfolios.length === 0) return null;

  function onSelect(scope: ScopeSelection) {
    document.cookie = `${SELECTED_PORTFOLIO_COOKIE}=${scopeToCookieValue(scope)}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    const params = new URLSearchParams(searchParams.toString());
    for (const key of SCOPE_RESET_PARAMS) params.delete(key);
    params.set(SCOPE_PARAM, formatScopeParam(scope));
    // push (not replace): a scope change is a navigation the back button should undo.
    // `ScopeSync` (in the app shell) refreshes the layout for the new scope — for this
    // push and for back/forward alike.
    router.push(`${pathname}?${params.toString()}`);
  }

  const selectedPortfolio = portfolios.find((p) => p.id === effectiveSelectedId);
  const selectedHolder = holders.find((h) => h.id === effectiveHolderId);

  const portfolioLabel = (p: Pick<Portfolio, "name" | "brokerage" | "accountHolder">) => {
    const parts = [p.name];
    if (p.brokerage) parts.push(p.brokerage);
    if (p.accountHolder) parts.push(p.accountHolder);
    return parts.join(" · ");
  };

  // With a single portfolio and no qualifying holders there's nothing to switch
  // between, but a static label still tells the user which portfolio every screen
  // is scoped to (the scope is otherwise invisible). No dropdown — purely an indicator.
  if (portfolios.length === 1 && holders.length === 0) {
    const only = portfolios[0];
    return (
      <div
        className="inline-flex max-w-full items-center gap-[9px] rounded-sm bg-background py-[7px] pl-2 pr-3.5 text-sm font-semibold text-foreground"
        aria-label={t("label")}
        title={portfolioLabel(only)}
      >
        <BrokerageIcon brokerage={only.brokerage} className="size-6 rounded-xs" />
        <span className="truncate">{portfolioLabel(only)}</span>
      </div>
    );
  }

  // Reference desktop trigger: page-bg 10px-radius button, 600 14px, 24px icon chip,
  // full descriptive label (`portLabelD`).
  const triggerIcon = selectedHolder ? (
    <Users className="size-4 shrink-0 text-muted-foreground" />
  ) : selectedPortfolio ? (
    <BrokerageIcon brokerage={selectedPortfolio.brokerage} className="size-6 rounded-xs" />
  ) : (
    <Layers className="size-4 shrink-0 text-muted-foreground" />
  );
  const triggerLabel = selectedHolder
    ? selectedHolder.name
    : selectedPortfolio
      ? portfolioLabel(selectedPortfolio)
      : t("all");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        className="inline-flex max-w-full items-center gap-[9px] rounded-sm bg-background py-[7px] pl-2 pr-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {triggerIcon}
        <span className="truncate">{triggerLabel}</span>
        <ChevronDown className="size-3.5 shrink-0 text-text-2" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[16rem]">
        {/* Section 1: All portfolios */}
        <DropdownMenuItem onSelect={() => onSelect({ kind: "all" })}>
          <Layers className="size-5 shrink-0 text-muted-foreground" />
          <span className="truncate">{t("all")}</span>
          <Check
            className={cn(
              "ml-auto size-4 shrink-0",
              !effectiveSelectedId && !effectiveHolderId ? "visible" : "invisible",
            )}
          />
        </DropdownMenuItem>

        {/* Section 2: Account holders (only when qualifying holders exist) */}
        {holders.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("accountHolders")}</DropdownMenuLabel>
            {holders.map((h) => (
              <DropdownMenuItem
                key={h.id}
                onSelect={() => onSelect({ kind: "holder", holderId: h.id })}
              >
                <Users className="size-5 shrink-0 text-muted-foreground" />
                <span className="truncate">{h.name}</span>
                <Check
                  className={cn(
                    "ml-auto size-4 shrink-0",
                    h.id === effectiveHolderId ? "visible" : "invisible",
                  )}
                />
              </DropdownMenuItem>
            ))}
          </>
        )}

        {/* Section 3: Individual portfolios */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("portfolios")}</DropdownMenuLabel>
        {portfolios.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => onSelect({ kind: "portfolio", portfolioId: p.id })}
          >
            <BrokerageIcon brokerage={p.brokerage} className="size-5" />
            <span className="truncate">{portfolioLabel(p)}</span>
            <Check
              className={cn(
                "ml-auto size-4 shrink-0",
                p.id === effectiveSelectedId ? "visible" : "invisible",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
