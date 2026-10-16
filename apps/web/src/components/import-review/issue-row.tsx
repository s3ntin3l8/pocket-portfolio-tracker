"use client";

import { useTranslations } from "next-intl";
import { TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ImportIssue } from "./types";
import { fmtQty, fmtAmt } from "./types";
import { Checkbox } from "@/components/ui/checkbox";

export function IssueRow({
  issue,
  onMap,
}: {
  issue: ImportIssue;
  onMap?: (issue: ImportIssue) => void;
}) {
  const t = useTranslations("Import");
  const pct = (c: number) => t("confidence", { pct: Math.round(c * 100) });
  return (
    <>
      <TableCell>
        <Checkbox
          className="size-4 opacity-40"
          disabled
          aria-label={t("review.selectRow")}
          checked={false}
        />
      </TableCell>
      <TableCell>
        <Badge variant="warning">{pct(0)}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline">—</Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline">—</Badge>
      </TableCell>
      <TableCell className="font-medium">{issue.raw?.name ?? issue.eventType ?? "—"}</TableCell>
      <TableCell className="tabular text-xs text-muted-foreground">
        {issue.raw?.isin ?? "—"}
      </TableCell>
      <TableCell className="tabular text-xs text-muted-foreground">
        {issue.raw?.wkn ?? "—"}
      </TableCell>
      <TableCell className="tabular whitespace-nowrap text-muted-foreground">
        {issue.raw?.executedAt?.slice(0, 10) ?? "—"}
      </TableCell>
      <TableCell numeric className="text-muted-foreground">
        {issue.raw?.shares != null ? fmtQty(String(issue.raw.shares)) : "—"}
      </TableCell>
      <TableCell numeric className="text-muted-foreground">
        {issue.raw?.amount != null ? fmtAmt(String(Math.abs(issue.raw.amount))) : "—"}
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell className="text-xs text-muted-foreground">{issue.raw?.currency ?? "—"}</TableCell>
      <TableCell className="text-right">
        {onMap && (
          <Button size="sm" variant="secondary" onClick={() => onMap(issue)}>
            {t("review.issues.map")}
          </Button>
        )}
      </TableCell>
    </>
  );
}
