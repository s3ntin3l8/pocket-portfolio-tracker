import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Draft-review placeholder: header, portfolio picker row, then a list of draft rows. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-10 w-full sm:w-72" />
      <Card>
        <div className="space-y-3 p-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-5 shrink-0" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="ml-auto h-5 w-28" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
