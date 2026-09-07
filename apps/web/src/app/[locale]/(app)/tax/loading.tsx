import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-6 w-1/3" />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
        <Card>
          <div className="space-y-3 p-6">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </Card>
        <Card>
          <div className="space-y-2 p-6">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        </Card>
        <Card>
          <div className="space-y-2 p-6">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        </Card>
        <Card>
          <div className="space-y-2 p-6">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          </Card>
        </div>
        <Card>
          <div className="space-y-4 p-6">
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-3/4" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
              <Skeleton className="h-16 rounded-md" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-1/4 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}
