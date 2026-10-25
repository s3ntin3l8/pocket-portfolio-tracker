import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Briefcase, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { PortfolioCardLink, PortfolioCardChevron } from "@/components/portfolio-card-link";
import { PortfolioSyncWatcher } from "@/components/portfolio-sync-watcher";
import { AccountHoldersManager } from "@/components/account-holders-manager";
import { BrokerageIcon } from "@/components/brokerage-icon";
import { Link } from "@/i18n/navigation";
import {
  loadAccountHolders,
  loadPortfolios,
  loadTrConnection,
  loadIbkrConnection,
} from "@/lib/server-api";
import { formatMoney } from "@/lib/utils";

/**
 * The Settings "Portfolios & holders" section: the full portfolio manager (create / edit /
 * delete cards + the account-holders manager) rendered inline within the settings shell —
 * no read-only intermediate, no "Manage ›" hop. Reached from the settings rail/landing.
 */
export default async function SettingsPortfoliosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Portfolios");
  const tf = await getTranslations("PortfolioForm");
  const te = await getTranslations("Empty");
  const ts = await getTranslations("Settings");
  const ttr = await getTranslations("TradeRepublic");
  const tibkr = await getTranslations("InteractiveBrokers");

  const [result, connection, ibkrConn, holders] = await Promise.all([
    loadPortfolios(),
    loadTrConnection(),
    loadIbkrConnection(),
    loadAccountHolders(),
  ]);

  const trPortfolioId =
    connection !== null && connection.status !== "disconnected" ? connection.portfolioId : null;
  const ibkrPortfolioId =
    ibkrConn !== null && ibkrConn.status !== "disconnected" ? ibkrConn.portfolioId : null;

  return (
    <>
      <PageHeader title={ts("portfoliosLink")} backHref="/settings" />

      <div className="space-y-6">
        {result.status !== "ok" ? (
          <DataState status={result.status} retryAfter={retryAfterOf(result)} />
        ) : result.portfolios.length > 0 ? (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {result.portfolios.map(({ portfolio, netWorth }) => {
              const isTrBound = portfolio.id === trPortfolioId;
              const isTrConnected = isTrBound && connection?.status === "connected";
              const isIbkrBound = portfolio.id === ibkrPortfolioId;
              const isIbkrConnected = isIbkrBound && ibkrConn?.status === "connected";
              const isSyncing =
                (isTrBound && connection?.syncing) || (isIbkrBound && ibkrConn?.syncing);
              // A status the catalogue doesn't know yet must not render the key path
              // (or throw) — fall back to a real, translatable label (R4-F7).
              const statusLabel = isTrBound
                ? connection &&
                  (ttr.has(`status.${connection.status}`)
                    ? ttr(`status.${connection.status}`)
                    : ttr("statusOther"))
                : isIbkrBound
                  ? ibkrConn &&
                    (tibkr.has(`status.${ibkrConn.status}`)
                      ? tibkr(`status.${ibkrConn.status}`)
                      : tibkr("statusOther"))
                  : null;

              const flags: string[] = [];
              if (portfolio.cashCounted) flags.push(t("cashIn"));
              if (portfolio.documentRetention) flags.push(t("docsKept"));
              if (portfolio.taxAllowanceAnnual != null) {
                flags.push(`FSA €${Math.round(Number(portfolio.taxAllowanceAnnual))}`);
              }

              return (
                <Card
                  key={portfolio.id}
                  className="relative flex flex-col rounded-lg border-border shadow-card transition-colors hover:bg-accent/50"
                >
                  {/* Overlay link — the whole card opens the inline edit page (design:
                      chevron affordance, no `⋯` menu). */}
                  <PortfolioCardLink portfolioId={portfolio.id} name={portfolio.name} />
                  {/* Headless — keeps the SYNCING…/CONNECTED badge below auto-updating; the
                      manual "Sync now" trigger now lives on the edit page instead. */}
                  <PortfolioSyncWatcher
                    trSync={
                      isTrConnected ? { initialSyncing: connection?.syncing ?? false } : undefined
                    }
                    ibkrSync={
                      isIbkrConnected ? { initialSyncing: ibkrConn?.syncing ?? false } : undefined
                    }
                  />
                  <CardContent className="flex flex-1 flex-col p-[17px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <BrokerageIcon brokerage={portfolio.brokerage} />
                        <div className="min-w-0">
                          <p className="truncate text-body font-bold">{portfolio.name}</p>
                          {portfolio.accountHolder && (
                            <p className="truncate text-xs text-muted-foreground">
                              {portfolio.accountHolder}
                            </p>
                          )}
                        </div>
                      </div>
                      <PortfolioCardChevron />
                    </div>
                    {statusLabel && (
                      <div className="mt-2.5">
                        <span
                          className={
                            "inline-flex items-center gap-1.5 rounded-xs px-2 py-1 text-micro font-bold " +
                            (isSyncing
                              ? "bg-warning/15 text-warn-strong"
                              : "bg-success/15 text-success-strong")
                          }
                        >
                          <span
                            className={
                              "size-1.5 shrink-0 rounded-full " +
                              (isSyncing ? "bg-warning" : "bg-success")
                            }
                          />
                          {statusLabel}
                        </span>
                      </div>
                    )}
                    <p className="tabular mt-4 text-heading font-bold">
                      {formatMoney(Number(netWorth), portfolio.baseCurrency, locale)}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                      {t("value")}
                    </p>
                    {/* Footer flag strip — only rendered when at least one non-default flag is set */}
                    {flags.length > 0 && (
                      <>
                        {/* flex-1 pushes footer to card bottom; min-h-2.5 keeps a minimum gap */}
                        <div className="min-h-2.5 flex-1" />
                        <div className="flex flex-wrap gap-x-2.5 gap-y-1.5 border-t border-border pt-2.5">
                          {flags.map((flag) => (
                            <span
                              key={flag}
                              className="text-micro font-medium text-muted-foreground"
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Link
              href="/settings/portfolios/new"
              className="flex min-h-[170px] flex-col items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-dashed border-border p-[18px] text-center text-muted-foreground transition-colors hover:bg-accent/40"
            >
              <span className="flex size-[42px] items-center justify-center rounded-md bg-success/15 text-success-strong">
                <Plus className="size-[22px]" />
              </span>
              <span className="text-sm font-bold text-foreground">{tf("new")}</span>
              <span className="text-xs text-muted-foreground">{t("newPortfolioHint")}</span>
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={Briefcase}
            title={te("noPortfolioTitle")}
            description={te("noPortfolioBody")}
            action={
              <Button asChild>
                <Link href="/settings/portfolios/new">
                  <Plus className="size-4" />
                  {tf("new")}
                </Link>
              </Button>
            }
          />
        )}

        {result.status === "ok" && <AccountHoldersManager holders={holders} />}
      </div>
    </>
  );
}
