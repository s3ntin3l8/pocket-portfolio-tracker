import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="size-9 rounded-md" />
        </div>
        <Skeleton className="h-4 w-1/4" />
      </div>
      <Card>
        <div className="space-y-3 p-6">
          <div className="flex gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-28 ml-auto" />
          </div>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20 ml-auto" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
