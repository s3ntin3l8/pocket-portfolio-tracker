"use client";

import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

export function LoadMoreSection({
  hasVisibleRows,
  hasMore,
  loadingMore,
  windowedCount,
  sortedTotal,
  total,
  onLoadMore,
}: {
  hasVisibleRows: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  windowedCount: number;
  sortedTotal: number;
  total?: number;
  onLoadMore: () => void;
}) {
  const tb = useTranslations("Transactions.batch");

  if (!hasVisibleRows || !hasMore) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <Button variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
        {loadingMore ? <Spinner size="sm" /> : null}
        {tb("loadMore")}
      </Button>
      <span className="text-xs text-muted-foreground">
        {tb("showingCount", {
          shown: windowedCount,
          total: Math.max(sortedTotal, total ?? 0),
        })}
      </span>
    </div>
  );
}
