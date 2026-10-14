import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Section content placeholder; the settings layout (rail + nav) stays mounted around it. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <div className="space-y-3 p-5">
            <Skeleton className="h-5 w-1/4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}
