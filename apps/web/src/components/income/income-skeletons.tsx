import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallbacks for the streamed Income sections (same footprints as loading.tsx). */
export function IncomeCardSkeleton({ height = "h-48" }: { height?: string }) {
  return (
    <Card>
      <div className="space-y-3 p-6" aria-hidden>
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className={`${height} w-full`} />
      </div>
    </Card>
  );
}

export function IncomeStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 @xl:grid-cols-1" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <div className="space-y-2 p-6">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  );
}
