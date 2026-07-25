"use client";

import { useState } from "react";
import { ReconciliationBanner } from "@/components/transactions/activity-banners";
import { anomalyLabel, type AnomalyTranslator } from "@/lib/utils";
import type { Anomaly } from "@portfolio/api-client";

export function ReconciliationBannerGroup({
  anomalies,
  ta,
  locale,
}: {
  anomalies: Anomaly[];
  ta: AnomalyTranslator;
  locale: string;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (anomalies.length === 0) return null;

  return (
    <>
      {anomalies
        .filter((a) => {
          const key = `${a.code}:${a.meta?.currency ?? a.meta?.isin ?? ""}`;
          return !dismissed.has(key);
        })
        .map((a, i) => {
          const key = `${a.code}:${a.meta?.currency ?? a.meta?.isin ?? i}`;
          return (
            <ReconciliationBanner
              key={key}
              title={ta("reconciliationTitle")}
              detail={anomalyLabel(a, ta, locale)}
              tag={ta("portfolioTag")}
              onDismiss={() => setDismissed((prev) => new Set(prev).add(key))}
            />
          );
        })}
    </>
  );
}
