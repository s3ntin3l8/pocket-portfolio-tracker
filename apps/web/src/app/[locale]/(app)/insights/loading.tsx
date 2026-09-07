import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card className="rounded-[20px]">
            <div className="space-y-3 p-6">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-10 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </Card>
          <Card>
            <div className="space-y-4 p-6">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-64 w-full" />
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card className="rounded-[20px]">
              <div className="space-y-2 p-4">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-7 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </Card>
            <Card className="rounded-[20px]">
              <div className="space-y-2 p-4">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-7 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </Card>
          </div>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-3 p-6">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          </Card>
        </div>
      </div>
      <Card>
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
        <Card>
          <div className="space-y-3 p-6">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-48 w-full" />
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
  );
}
