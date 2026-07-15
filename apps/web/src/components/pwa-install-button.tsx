"use client";

import { useTranslations } from "next-intl";
import { Download, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/lib/use-pwa-install";

/**
 * Settings-card PWA install affordance — the fallback for users who dismissed the
 * banner. Renders a one-tap install button (Chromium) or iOS instructions (Safari).
 * Hidden entirely when already in standalone/PWA mode (matches the banner).
 */
export function PwaInstallButton() {
  const t = useTranslations("Settings");
  const { deferred, eligible, install, isStandalone } = usePwaInstall();

  if (isStandalone || !eligible) return null;

  if (eligible.ios && !deferred) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t("installAppIosTitle")}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Share className="inline size-3.5 shrink-0" />
              {t("installAppIosHint")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="text-sm font-medium">{t("installAppDesc")}</p>
        </div>
      </div>
      <Button onClick={install} className="w-fit">
        <Download className="mr-2 size-4" />
        {t("installAppCta")}
      </Button>
    </div>
  );
}
