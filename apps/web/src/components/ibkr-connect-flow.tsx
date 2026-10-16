"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, Plug, Unplug } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { apiErrorCode } from "@portfolio/api-client";
import type { ApiClient, IbkrConnection } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ConnectedCompactRow } from "@/components/broker/connected-compact-row";
import { ReconcileSummary } from "@/components/broker/reconcile-summary";

export type IbkrConnectClient = Pick<
  ApiClient,
  "connectIbkr" | "syncIbkr" | "disconnectIbkr" | "getIbkrConnection" | "reimportIbkr"
>;

type Phase = "form" | "connected";

function phaseFor(status: IbkrConnection["status"]): Phase {
  return status === "connected" ? "connected" : "form";
}

export function IbkrConnectFlow({
  client,
  portfolioId,
  initial,
  onChanged,
  compact = false,
}: {
  client: IbkrConnectClient;
  portfolioId: string;
  initial: IbkrConnection;
  onChanged?: () => void;
  /** Collapse the connected state to a single row (last sync, Sync, ⋯ menu). Every other
   *  status keeps the full flow. */
  compact?: boolean;
}) {
  const t = useTranslations("InteractiveBrokers");
  const tB = useTranslations("BrokerConnection");
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>(phaseFor(initial.status));
  const [token, setToken] = useState("");
  const [queryId, setQueryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReimport, setConfirmingReimport] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const expired = initial.status === "expired";

  function messageForError(err: unknown): string {
    const code = apiErrorCode(err);
    if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
    return t("error");
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setBusy(false);
    }
  }

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !token || !queryId || !portfolioId) return;
    void run(async () => {
      await client.connectIbkr({ token, queryId, portfolioId });
      setToken("");
      setPhase("connected");
      onChanged?.();
    });
  };

  const doSync = () => {
    void client
      .syncIbkr()
      .then(() => {
        toast.success(t("syncQueued"));
        onChanged?.();
      })
      .catch((err: unknown) => {
        toast.error(messageForError(err));
      });
  };

  const disconnect = () =>
    void run(async () => {
      await client.disconnectIbkr();
      setConfirmingDisconnect(false);
      setPhase("form");
      onChanged?.();
    });

  const reimport = () =>
    void run(async () => {
      await client.reimportIbkr();
      setConfirmingReimport(false);
      onChanged?.();
    });

  return (
    <div className="max-w-md space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {phase === "form" && (
        <form onSubmit={connect} className="space-y-4">
          {expired && <p className="text-sm text-muted-foreground">{t("expiredHint")}</p>}
          <p className="text-xs text-muted-foreground">{t("setupHint")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="ibkr-token">{t("flexToken")}</Label>
            <Input
              id="ibkr-token"
              type="password"
              placeholder={t("flexTokenPlaceholder")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ibkr-query-id">{t("queryId")}</Label>
            <Input
              id="ibkr-query-id"
              type="text"
              inputMode="numeric"
              placeholder={t("queryIdPlaceholder")}
              value={queryId}
              onChange={(e) => setQueryId(e.target.value)}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !token || !queryId || !portfolioId}>
              {busy ? <Spinner size="sm" /> : <Plug className="size-4" />}
              {t("connect")}
            </Button>
          </div>
        </form>
      )}

      {phase === "connected" && compact && initial.status === "connected" && (
        <>
          <ConnectedCompactRow
            lastSyncAt={initial.lastSyncAt}
            syncLabel={t("syncNow")}
            onSync={doSync}
            busy={busy}
            menuItems={[
              {
                key: "reimport",
                label: t("reimport.action"),
                onSelect: () => setConfirmingReimport(true),
              },
              {
                key: "disconnect",
                label: t("disconnect"),
                destructive: true,
                onSelect: () => setConfirmingDisconnect(true),
              },
            ]}
            details={
              <>
                {initial.flexAccountId && (
                  <p className="text-xs text-muted-foreground">
                    {t("accountId")}: <span className="font-mono">{initial.flexAccountId}</span>
                  </p>
                )}
                <ReconcileSummary
                  recon={initial.lastReconciliation}
                  namespace="InteractiveBrokers"
                />
              </>
            }
          />
          <ConfirmActionDialog
            open={confirmingDisconnect}
            onOpenChange={setConfirmingDisconnect}
            title={tB("disconnectTitle", { broker: "Interactive Brokers" })}
            description={tB("disconnectBody")}
            confirmLabel={t("disconnect")}
            busy={busy}
            onConfirm={disconnect}
          />
          <ConfirmActionDialog
            open={confirmingReimport}
            onOpenChange={setConfirmingReimport}
            title={t("reimport.action")}
            description={t("reimport.warning")}
            confirmLabel={t("reimport.confirm")}
            busy={busy}
            onConfirm={reimport}
          />
        </>
      )}

      {phase === "connected" && !(compact && initial.status === "connected") && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("connectedHint")}</p>

          {initial.flexAccountId && (
            <p className="text-xs text-muted-foreground">
              {t("accountId")}: <span className="font-mono">{initial.flexAccountId}</span>
            </p>
          )}

          {initial.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              {t("lastSync")}: {new Date(initial.lastSyncAt).toLocaleString(locale)}
            </p>
          )}

          <ReconcileSummary recon={initial.lastReconciliation} namespace="InteractiveBrokers" />

          <div className="flex items-center justify-end gap-3">
            <Button onClick={doSync} disabled={busy}>
              {busy ? <Spinner size="sm" /> : <RefreshCw className="size-4" />}
              {t("syncNow")}
            </Button>
            <Button variant="outline" onClick={disconnect} disabled={busy}>
              <Unplug className="size-4" />
              {t("disconnect")}
            </Button>
          </div>

          <div className="border-t pt-3">
            {confirmingReimport ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("reimport.warning")}</span>
                <Button variant="destructive" size="sm" onClick={reimport} disabled={busy}>
                  {busy && <Spinner size="xs" />}
                  {t("reimport.confirm")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingReimport(false)}
                  disabled={busy}
                >
                  {t("cancel")}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setConfirmingReimport(true)}
              >
                {t("reimport.action")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
