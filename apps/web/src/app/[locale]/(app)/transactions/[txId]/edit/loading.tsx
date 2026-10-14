import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Edit-transaction placeholder: header plus a form card. */
export default function Loading() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-1">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Card>
        <div className="space-y-4 p-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-32" />
        </div>
      </Card>
    </div>
  );
}
