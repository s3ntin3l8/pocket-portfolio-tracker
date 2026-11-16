"use client";

import { useState } from "react";
import { isReconciliationAnomaly } from "@/lib/utils";
import { ReconciliationBanner } from "@/components/transactions/activity-banners";

export interface BannerItem {
  key: string;
  title: string;
  detail: string;
  tag: string;
  /** Anomaly code — the group title only applies when every item is a broker reconciliation gap. */
  code: string;
  /** `Anomalies.dismiss` — pre-resolved server-side, same reason as the other fields. */
  dismissLabel: string;
  action?: { href: string; label: string };
}

export function ReconciliationBannerGroup({
  items,
  groupTitle,
}: {
  items: BannerItem[];
  /** Title when several gaps are bundled (`Anomalies.reconciliationGroupTitle`). */
  groupTitle: string;
}) {
  // Portfolio-scoped anomalies carry no transaction to point at, so the server-side
  // dismissal table (keyed by transaction) cannot record them — the dismissal is
  // therefore session-scoped and the banner returns on the next navigation. The label
  // says so, so the behaviour is not a surprise.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = items.filter((item) => !dismissed.has(item.key));
  if (visible.length === 0) return null;
  const [first, ...rest] = visible;

  // One banner for every gap: cash and position gaps share a cause (a draft not yet
  // confirmed, a missing booking), so they are one thing to look at, not N cards.
  return (
    <ReconciliationBanner
      title={
        rest.length > 0 && visible.every((v) => isReconciliationAnomaly(v.code))
          ? groupTitle
          : first.title
      }
      detail={first.detail}
      tag={first.tag}
      dismissLabel={first.dismissLabel}
      action={first.action}
      rows={rest.map((r) => ({ key: r.key, detail: r.detail, action: r.action }))}
      onDismiss={() => setDismissed((prev) => new Set([...prev, ...visible.map((v) => v.key)]))}
    />
  );
}
