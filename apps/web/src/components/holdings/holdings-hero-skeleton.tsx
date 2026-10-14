import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for the Holdings hero (net worth + chart) while its history streams in. */
export function HoldingsHeroSkeleton() {
  return (
    <Card>
      <div className="space-y-4 p-6" aria-hidden>
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </Card>
  );
}
