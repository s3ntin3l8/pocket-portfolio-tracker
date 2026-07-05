import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  caption,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  /** A short muted line under the value/delta — e.g. "Top: Gold · moderate". No trend
   *  semantics (unlike `delta`); used for tiles that describe rather than compare. */
  caption?: string;
}) {
  return (
    <Card>
      <CardContent className="p-[15px]">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <p className="tabular mt-2 text-[18px] font-extrabold">{value}</p>
        {delta && (
          <p
            className={cn(
              "tabular mt-1 text-[11px] font-bold",
              deltaTone === "up" && "text-success",
              deltaTone === "down" && "text-destructive",
              deltaTone === "neutral" && "text-muted-foreground",
            )}
          >
            {delta}
          </p>
        )}
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </CardContent>
    </Card>
  );
}
