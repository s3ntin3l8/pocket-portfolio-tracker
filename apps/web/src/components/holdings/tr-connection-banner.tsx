"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { TrConnection } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TrConnectFlow } from "@/components/tr-connect-flow";
import { useApiClient } from "@/lib/api";

/**
 * Holdings-page notice that the Trade Republic sync stopped because the login expired (or
 * the last sync failed), with a one-tap Renew. Renders nothing for a working, absent or
 * mid-pairing connection. The renew itself is `TrConnectFlow`'s: it reuses the saved
 * credentials, so the user only confirms in the Trade Republic app.
 */
export function TrConnectionBanner({ connection }: { connection: TrConnection | null }) {
  const t = useTranslations("TradeRepublic");
  const api = useApiClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!connection || !connection.portfolioId) return null;
  // A renew the user walked away from leaves `awaiting_2fa` with no pairing behind it. The
  // server reaps that to `expired` within the hour; until then treat it as expired here so the
  // prompt never disappears. A connection that never synced is a first setup, not a renew.
  const abandoned =
    connection.status === "awaiting_2fa" &&
    connection.pairingMethod === null &&
    connection.lastSyncAt !== null;
  if (connection.status !== "expired" && connection.status !== "error" && !abandoned) return null;
  const flowConnection: TrConnection = abandoned
    ? { ...connection, status: "expired" }
    : connection;

  const expired = connection.status !== "error";

  // The flow reports every change: an approval, but also a cancelled renew. Only a connection
  // that is actually `connected` again closes the dialog and syncs; anything else just
  // refreshes so the banner reflects the server's state.
  const changed = () => {
    void api
      .getTrConnection()
      .then((latest) => {
        if (latest.status === "connected") {
          setOpen(false);
          void api.syncTr().catch(() => undefined);
        }
      })
      .catch(() => undefined)
      .finally(() => router.refresh());
  };

  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warn-strong"
      >
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">
            {expired ? t("banner.expired.title") : t("banner.error.title")}
          </span>{" "}
          {expired ? t("banner.expired.body") : t("banner.error.body")}
        </span>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t("banner.action")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("banner.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {expired ? t("renewHint") : t("banner.dialogHintError")}
            </DialogDescription>
          </DialogHeader>
          <TrConnectFlow
            client={api}
            portfolioId={connection.portfolioId}
            cashCounted
            initial={flowConnection}
            compact
            onChanged={changed}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
