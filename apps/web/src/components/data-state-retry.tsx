"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Inline Retry for `<DataState>`: re-runs the server loaders via `router.refresh()`.
 * With `retryAfter` it is disabled and shows a live countdown until the API's rate-limit
 * window has passed.
 */
export function DataStateRetry({ retryAfter }: { retryAfter?: number | null }) {
  const t = useTranslations("DataState");
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const remaining = Math.max(0, (retryAfter && retryAfter > 0 ? retryAfter : 0) - elapsed);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setTimeout(() => setElapsed((e) => e + 1), 1000);
    return () => clearTimeout(id);
  }, [remaining]);

  return (
    <Button variant="outline" disabled={remaining > 0} onClick={() => router.refresh()}>
      <RefreshCw className="size-4" />
      {remaining > 0 ? t("retryIn", { seconds: remaining }) : t("retry")}
    </Button>
  );
}
