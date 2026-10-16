import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors `TaxReportsPage`: report header, picker + upload toolbar, then the documents
 * table (desktop) / card list (mobile) from `TaxReportsInbox`. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden data-testid="reports-documents-loading">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-48 md:hidden" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Card className="hidden overflow-hidden lg:block">
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
        <div className="space-y-2 lg:hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="size-8 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-16 shrink-0" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
