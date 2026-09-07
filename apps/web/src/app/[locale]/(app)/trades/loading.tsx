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
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-5 @xl:grid-cols-[1fr_320px] @xl:items-start">
        <div className="space-y-5">
          <Card>
            <div className="space-y-3 p-6">
              <div className="flex gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20 ml-auto" />
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-20 ml-auto" />
                </div>
              ))}
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-32 w-full" />
              </div>
            </Card>
            <Card>
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-32 w-full" />
              </div>
            </Card>
          </div>
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 @xl:grid-cols-1">
            <Card>
              <div className="space-y-2 p-6">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-7 w-1/2" />
              </div>
            </Card>
            <Card>
              <div className="space-y-2 p-6">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-7 w-1/2" />
              </div>
            </Card>
            <Card>
              <div className="space-y-2 p-6">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-7 w-1/2" />
              </div>
            </Card>
            <Card>
              <div className="space-y-2 p-6">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-7 w-1/2" />
              </div>
            </Card>
          </div>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-2 w-full rounded-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
