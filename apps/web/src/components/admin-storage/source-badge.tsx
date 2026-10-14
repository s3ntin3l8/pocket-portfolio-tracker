"use client";

import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/tooltip";

export function SourceBadge({ source }: { source: "db" | "env" }) {
  const t = useTranslations("Admin");
  return (
    <InfoTip label={source === "db" ? t("storageFromDbHint") : t("storageFromEnvHint")} focusable>
      <span
        className={`ml-1 rounded px-1 py-0.5 text-micro font-mono leading-none ${
          source === "db" ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"
        }`}
      >
        {source === "db" ? t("storageFromDb") : t("storageFromEnv")}
      </span>
    </InfoTip>
  );
}
