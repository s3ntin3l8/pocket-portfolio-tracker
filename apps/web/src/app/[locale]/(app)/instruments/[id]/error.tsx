"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for an instrument page. Same translated frame as the app-level boundary:
 * the raw error message is never shown (it can carry internals), only the digest as a
 * quotable reference. `reset()` retries the failed segment render.
 */
export default function InstrumentError({
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
