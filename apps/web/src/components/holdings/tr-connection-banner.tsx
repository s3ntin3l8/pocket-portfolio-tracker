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
  if (connection.status !== "expired" && connection.status !== "error") return null;

  const expired = connection.status === "expired";

  // The flow calls this once the approval lands; a sync pulls what was missed meanwhile.
  const renewed = () => {
    setOpen(false);
    void api.syncTr().catch(() => undefined);
    router.refresh();
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
            <DialogDescription>{t("renewHint")}</DialogDescription>
          </DialogHeader>
          <TrConnectFlow
            client={api}
            portfolioId={connection.portfolioId}
            cashCounted
            initial={connection}
            compact
            onChanged={renewed}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
