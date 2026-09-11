import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0 rounded-xl" />
        <Skeleton className="size-11 shrink-0 rounded-[13px]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-48" />
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <span aria-hidden>·</span>
            <Skeleton className="h-3 w-12" />
            <span aria-hidden>·</span>
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 @xl:grid-cols-[minmax(0,1fr)_300px] @xl:items-start">
        <div className="space-y-6 min-w-0">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-1/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-72 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-1/3" />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2.5 sm:gap-4 @md:grid-cols-4">
              <Skeleton className="h-[74px] rounded-2xl" />
              <Skeleton className="h-[74px] rounded-2xl" />
              <Skeleton className="h-[74px] rounded-2xl" />
              <Skeleton className="h-[74px] rounded-2xl" />
            </CardContent>
          </Card>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-1/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-1/3" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48 w-full" />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-1/3" />
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6 @xl:sticky @xl:top-[calc(70px+env(safe-area-inset-top))] @xl:max-h-[calc(100dvh-90px)] @xl:overflow-y-auto @xl:order-last">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-1/3" />
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:gap-4">
              <Skeleton className="h-[60px] rounded-2xl" />
              <Skeleton className="h-[60px] rounded-2xl" />
              <Skeleton className="h-[60px] rounded-2xl" />
              <Skeleton className="h-[60px] rounded-2xl" />
              <Skeleton className="h-[60px] rounded-2xl" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
