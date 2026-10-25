"use client";

import { useLocale, useTranslations } from "next-intl";
import type { AdminProviderUsage } from "@portfolio/api-client";

export function UsageCell({ usage }: { usage: AdminProviderUsage | null | undefined }) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  if (!usage || usage.used === null) {
    return <span className="text-muted-foreground">—</span>;
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
    </span>
  );
}
