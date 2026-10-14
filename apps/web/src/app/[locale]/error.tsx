"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";

/**
 * Locale-level error boundary: catches render failures in routes OUTSIDE the (app) group —
 * the landing page and onboarding — which (app)/error.tsx never covers. Rendered inside
 * [locale]/layout, so the theme and next-intl providers are in scope but there is no app
 * shell; the state is centered on a blank page (same arrangement as not-found.tsx).
 */
export default function LocaleError({
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
    <div className="flex min-h-dvh items-center justify-center">
      <ErrorState
        icon={AlertTriangle}
        tone="warn"
        eyebrow="500"
        title={t("title")}
        body={t("body")}
        code={error.digest ? `REF · ${error.digest}` : undefined}
        primary={<Button onClick={reset}>{t("retry")}</Button>}
      />
    </div>
  );
}
