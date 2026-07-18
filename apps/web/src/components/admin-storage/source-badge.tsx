"use client";

import { useTranslations } from "next-intl";

export function SourceBadge({ source }: { source: "db" | "env" }) {
  const t = useTranslations("Admin");
  return (
    <span
      className={`ml-1 rounded px-1 py-0.5 text-[10px] font-mono leading-none ${
        source === "db"
          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
          : "bg-muted text-muted-foreground"
      }`}
      title={source === "db" ? t("storageFromDbHint") : t("storageFromEnvHint")}
    >
      {source === "db" ? t("storageFromDb") : t("storageFromEnv")}
    </span>
  );
}
