import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-1/4" />
      </div>

      {/* Hero chart: full-width above the table (matches the promoted HeroGlanceCard). */}
      <Card>
        <div className="space-y-4 p-6">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 @xl:grid-cols-[1fr_320px] @xl:items-start">
        <div className="space-y-5">
          <Skeleton className="h-6 w-40" />
          {/* Toolbar: chips left, search + export right — matches PositionsPanel. */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex gap-2">
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-2 md:ml-auto">
              <Skeleton className="h-8 w-full md:w-56" />
              <Skeleton className="size-11 shrink-0 rounded-[13px] md:size-8" />
            </div>
          </div>
          <Card>
            <div className="space-y-3 p-6">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28 ml-auto" />
              </div>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-28 ml-auto" />
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-3.5">
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
