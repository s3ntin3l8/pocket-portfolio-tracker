import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-xl" />
        <Skeleton className="size-11 rounded-[13px]" />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 @xl:grid-cols-[1fr_320px] @xl:items-start">
        <div className="space-y-6">
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-72 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-5 w-1/3" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
              </div>
            </div>
          </Card>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
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
              <Skeleton className="h-6 w-1/3" />
              <div className="space-y-2">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex gap-4">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-20 ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-6 w-1/3" />
          <div className="grid grid-cols-1 gap-2.5 sm:gap-4">
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
            <Card>
              <div className="space-y-2 p-6">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-7 w-1/2" />
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
