"use client";

import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { TrConnectFlow, type TrConnectClient } from "@/components/tr-connect-flow";
import { IbkrConnectFlow, type IbkrConnectClient } from "@/components/ibkr-connect-flow";
import type { Portfolio, TrConnection, IbkrConnection } from "@portfolio/api-client";

type ConnectionStatus = "connected" | "awaiting_2fa" | "expired" | "error" | "disconnected";

const PILL_TONE: Record<"ok" | "pending" | "bad" | "idle", string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: "bg-destructive/15 text-destructive",
  idle: "bg-muted text-muted-foreground",
};

/**
 * The broker connection is its own thing, not a field of the portfolio form — so it's a
 * card (with its state at a glance) that sits ABOVE the form, not a section trailing the
 * Save button as if it were part of what Save saves.
 */
function ConnectionCard({
  title,
  status,
  children,
}: {
  title: string;
  /** Omitted while loading / unavailable (no connection object to read a state from). */
  status?: ConnectionStatus;
  children: React.ReactNode;
}) {
  const t = useTranslations("PortfolioForm");
  const pill =
    status === undefined
      ? null
      : status === "connected"
        ? { tone: "ok" as const, label: t("connectionConnected") }
        : status === "awaiting_2fa"
          ? { tone: "pending" as const, label: t("connectionAwaiting") }
          : status === "expired" || status === "error"
            ? { tone: "bad" as const, label: t("connectionAttention") }
            : { tone: "idle" as const, label: t("connectionNotConnected") };
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {pill && (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${PILL_TONE[pill.tone]}`}
          >
            {pill.label}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function TrConnectionSection({
  trConnection,
  effectivePortfolio,
  cashCounted,
  boundElsewhere,
  trInitForFlow,
  client,
  onRefresh,
  onFetchTrigger,
}: {
  trConnection: TrConnection | null | false;
  effectivePortfolio: Pick<Portfolio, "id">;
  cashCounted: boolean;
  boundElsewhere: boolean;
  trInitForFlow: TrConnection | null;
  client: TrConnectClient;
  onRefresh: () => void;
  onFetchTrigger: () => void;
}) {
  const t = useTranslations("PortfolioForm");
  const ttr = useTranslations("TradeRepublic");
  const te = useTranslations("Empty");

  return (
    <ConnectionCard
      title={t("trSectionTitle")}
      // The flow renders from `trInitForFlow` (rewritten to "disconnected" when the account is
      // bound to another portfolio) — the pill must read the same value or it says "Connected"
      // above a connect form.
      status={trConnection ? (trInitForFlow ?? trConnection).status : undefined}
    >
      {trConnection === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          <span>{t("trLoading")}</span>
        </div>
      ) : trConnection === false ? (
        <p className="text-sm text-muted-foreground">{te("unavailableBody")}</p>
      ) : (
        <>
          {boundElsewhere && (
            <div
              role="note"
              className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            >
              {ttr("boundElsewhere")}
            </div>
          )}
          <TrConnectFlow
            client={client}
            portfolioId={effectivePortfolio.id}
            cashCounted={cashCounted}
            initial={trInitForFlow!}
            compact
            onChanged={() => {
              onRefresh();
              onFetchTrigger();
            }}
          />
        </>
      )}
    </ConnectionCard>
  );
}

export function IbkrConnectionSection({
  ibkrConnection,
  effectivePortfolio,
  client,
  onRefresh,
  onFetchTrigger,
}: {
  ibkrConnection: IbkrConnection | null | false;
  effectivePortfolio: Pick<Portfolio, "id">;
  client: IbkrConnectClient;
  onRefresh: () => void;
  onFetchTrigger: () => void;
}) {
  const t = useTranslations("PortfolioForm");
  const tibkr = useTranslations("InteractiveBrokers");
  const te = useTranslations("Empty");

  return (
    <ConnectionCard
      title={tibkr("sectionTitle")}
      status={ibkrConnection ? ibkrConnection.status : undefined}
    >
      {ibkrConnection === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          <span>{t("trLoading")}</span>
        </div>
      ) : ibkrConnection === false ? (
        <p className="text-sm text-muted-foreground">{te("unavailableBody")}</p>
      ) : (
        <IbkrConnectFlow
          client={client}
          portfolioId={effectivePortfolio.id}
          initial={ibkrConnection}
          compact
          onChanged={() => {
            onRefresh();
            onFetchTrigger();
          }}
        />
      )}
    </ConnectionCard>
  );
}
