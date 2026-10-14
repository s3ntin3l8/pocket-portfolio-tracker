import { Skeleton } from "@/components/ui/skeleton";
import { ReportCardSkeleton } from "@/components/reports/report-card-skeleton";

export default function Loading() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 @min-[1500px]:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ReportCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
