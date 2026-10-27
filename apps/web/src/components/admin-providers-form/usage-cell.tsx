"use client";

import { useLocale, useTranslations } from "next-intl";
import type { AdminProviderUsage } from "@portfolio/api-client";

export function UsageCell({
  usage,
  pausedUntil,
}: {
  usage: AdminProviderUsage | null | undefined;
  pausedUntil?: string | null;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const paused = pausedUntil
    ? t("usagePausedUntil", {
        time: new Date(pausedUntil).toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        }),
      })
    : null;
  if (!usage || usage.used === null) {
    return paused ? (
      <span className="text-xs text-amber-600 dark:text-amber-400">{paused}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }
  const window = {
    minute: t("usageMinute"),
    day: t("usageDay"),
    month: t("usageMonth"),
  }[usage.window];
  const used = usage.used.toLocaleString(locale);
  const text =
    usage.limit !== null
      ? t("usageUsedOfLimit", { used, limit: usage.limit.toLocaleString(locale), window })
      : t("usageUsed", { used, window });
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {text}
      {usage.source === "local" && ` (${t("usageLocalHint")})`}
      {paused && <span className="text-amber-600 dark:text-amber-400"> · {paused}</span>}
    </span>
  );
}
