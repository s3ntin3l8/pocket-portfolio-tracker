"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

/** Income route error boundary — keeps the app shell mounted; `reset()` retries the segment. */
export default function IncomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Error");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      icon={AlertTriangle}
      tone="warn"
      eyebrow="500"
      title={t("title")}
      body={t("body")}
      code={error.digest ? `REF · ${error.digest}` : undefined}
      primary={<Button onClick={reset}>{t("retry")}</Button>}
    />
  );
}
