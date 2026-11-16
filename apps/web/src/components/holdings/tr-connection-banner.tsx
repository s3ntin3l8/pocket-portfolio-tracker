"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock } from "lucide-react";
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
import { trBannerKind } from "@/lib/tr-banner";

/**
 * Holdings-page notice about the Trade Republic login, with a one-tap Renew: the sync stopped
 * because it expired (or the last sync failed), or it is about to (a login lasts 24 h and
 * syncing does not extend it, so renewing a few hours early avoids a gap). Renders nothing for
 * a healthy, absent or mid-pairing connection. The renew itself is `TrConnectFlow`'s: it
 * reuses the saved credentials, so the user only confirms in the Trade Republic app.
 */
export function TrConnectionBanner({ connection }: { connection: TrConnection | null }) {
  const t = useTranslations("TradeRepublic");
  const api = useApiClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // One snapshot per mount: the countdown is a rounded "about N h", not a ticking clock.
  const [now] = useState(() => Date.now());

  const banner = trBannerKind(connection, now);
  if (!connection?.portfolioId || !banner) return null;
  const portfolioId = connection.portfolioId;
  const expiring = banner.kind === "expiring";
  const flowConnection: TrConnection =
    banner.kind === "abandoned" ? { ...connection, status: "expired" } : connection;

  // The flow reports every change: an approval, but also a cancelled renew. Only a connection
  // that is actually `connected` again closes the dialog; one that had stopped syncing is then
  // synced to catch up. Anything else just refreshes so the banner reflects the server.
  const changed = () => {
    void api
      .getTrConnection()
      .then((latest) => {
        if (latest.status === "connected") {
          setOpen(false);
          if (!expiring) void api.syncTr().catch(() => undefined);
        }
      })
      .catch(() => undefined)
      .finally(() => router.refresh());
  };

  const title = expiring
    ? banner.hoursLeft === null
      ? t("banner.expiring.titleNow")
      : t("banner.expiring.title", { hours: banner.hoursLeft })
    : banner.kind === "error"
      ? t("banner.error.title")
      : t("banner.expired.title");
  const body = expiring
    ? t("banner.expiring.body")
    : banner.kind === "error"
      ? t("banner.error.body")
      : t("banner.expired.body");
  const hint = expiring
    ? t("banner.dialogHintExpiring")
    : banner.kind === "error"
      ? t("banner.dialogHintError")
      : t("renewHint");

  return (
    <>
      <div
        role="status"
        className={
          expiring
            ? "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-muted/40 px-3 py-2.5 text-sm text-foreground"
            : "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warn-strong"
        }
      >
        {expiring ? (
          <Clock className="size-4 shrink-0" aria-hidden />
        ) : (
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-semibold" suppressHydrationWarning>
            {title}
          </span>{" "}
          {body}
        </span>
        <Button type="button" size="sm" onClick={() => setOpen(true)}>
          {t("banner.action")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t("banner.dialogTitle")}</DialogTitle>
            <DialogDescription>{hint}</DialogDescription>
          </DialogHeader>
          <TrConnectFlow
            client={api}
            portfolioId={portfolioId}
            cashCounted
            initial={flowConnection}
            compact
            autoRenew={expiring}
            onChanged={changed}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
