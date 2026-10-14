import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder with the footprint of a `ReportCard` — used as the Suspense fallback for each
 *  Reports card and by the route's loading.tsx. */
export function ReportCardSkeleton() {
  return (
    <Card>
      <div className="space-y-4 p-5" aria-hidden>
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="ml-auto h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-2 w-full" />
        <div className="flex gap-6">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </Card>
  );
}
