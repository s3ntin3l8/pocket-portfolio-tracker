import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <div className="space-y-2 p-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-7 w-3/4" />
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 @3xl:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <div className="space-y-3 p-5">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
