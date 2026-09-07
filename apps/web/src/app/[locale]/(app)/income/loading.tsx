import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid grid-cols-1 gap-5 @xl:grid-cols-[1fr_320px] @xl:items-start">
        <div className="space-y-5">
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-48 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: 28 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-md" />
                ))}
              </div>
            </div>
          </Card>
          <div className="grid gap-4 @2xl:grid-cols-2 @2xl:items-start">
            <Card>
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-48 w-full" />
              </div>
            </Card>
            <Card>
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-48 w-full" />
              </div>
            </Card>
          </div>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-1/4 ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
        <div className="grid grid-cols-1 space-y-2.5 sm:space-y-4">
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
          <Card>
            <div className="space-y-2 p-6">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-7 w-1/2" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
