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
              <Skeleton className="h-64 w-full" />
            </div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-48 w-full" />
              </div>
            </Card>
            <Card>
              <div className="space-y-3 p-6">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-48 w-full" />
              </div>
            </Card>
          </div>
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
