"use client";

import { useTranslations } from "next-intl";
import type { ImportIssue } from "./types";

export function EnrichmentNotice({ count }: { count: number }) {
  const t = useTranslations("Import");
  if (count === 0) return null;
  return (
    <div className="rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-sm text-info">
      {t("review.enrichmentNotice", { count })}
    </div>
  );
}

export function DuplicateNotice({ count }: { count: number }) {
  const t = useTranslations("Import");
  if (count === 0) return null;
  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      {t("review.duplicateNotice", { count })}
    </div>
  );
}

export function IssuesBanner({
  attention,
  ignorable,
}: {
  attention: ImportIssue[];
  ignorable: ImportIssue[];
}) {
  const t = useTranslations("Import");
  if (attention.length === 0 && ignorable.length === 0) return null;
  return (
    <div className="space-y-2">
      {attention.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warn-strong">
          <span className="font-medium">
            {t("review.issues.attention", { count: attention.length })}
          </span>
          <span className="text-warn-strong/70">— {t("review.issues.attentionHint")}</span>
        </div>
      )}
      {ignorable.length > 0 && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">
            {t("review.issues.ignored", { count: ignorable.length })}
          </summary>
          <ul className="mt-1.5 space-y-1 pl-4">
            {ignorable.map((issue, i) => (
              <li key={issue.eventId ?? i}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
