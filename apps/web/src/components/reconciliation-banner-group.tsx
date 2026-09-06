"use client";

import { useState } from "react";
import { ReconciliationBanner } from "@/components/transactions/activity-banners";

export interface BannerItem {
  key: string;
  title: string;
  detail: string;
  tag: string;
  /** `Anomalies.dismiss` — pre-resolved server-side, same reason as the other fields. */
  dismissLabel: string;
}

export function ReconciliationBannerGroup({ items }: { items: BannerItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

  return (
    <>
      {items
        .filter((item) => !dismissed.has(item.key))
        .map((item) => (
          <ReconciliationBanner
            key={item.key}
            title={item.title}
            detail={item.detail}
            tag={item.tag}
            dismissLabel={item.dismissLabel}
            onDismiss={() => setDismissed((prev) => new Set(prev).add(item.key))}
          />
        ))}
    </>
  );
}
