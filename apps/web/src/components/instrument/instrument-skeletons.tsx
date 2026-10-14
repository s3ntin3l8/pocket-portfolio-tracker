import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallbacks for the streamed instrument sections (footprints match loading.tsx). */
export function InstrumentCardSkeleton({ height = "h-40" }: { height?: string }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-1/3" />
      </CardHeader>
      <CardContent>
        <Skeleton className={`${height} w-full`} aria-hidden />
      </CardContent>
    </Card>
  );
}

export function InstrumentTransactionsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-6 w-1/4" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
