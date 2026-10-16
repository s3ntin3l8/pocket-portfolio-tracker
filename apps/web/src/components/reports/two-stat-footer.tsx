import { CardLabel } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";

/**
 * Footer row shared by every {@link ReportCard}: up to two small label/value stats on the
 * left, an "Open ›" affordance on the right (brand green: the card is a link).
 */
export function TwoStatFooter({
  metrics,
  openLabel,
}: {
  metrics: Array<{ label: string; value: string; color?: string }>;
  openLabel: string;
}) {
  return (
    <div className="mt-auto flex min-w-0 items-end justify-between gap-3.5 border-t border-line pt-4">
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
        {metrics.map((m, i) => (
          <div key={i} className="min-w-0">
            <CardLabel className="[overflow-wrap:normal] [word-break:break-word]">
              {m.label}
            </CardLabel>
            <p
              className="tabular mt-[3px] whitespace-nowrap text-body font-bold"
              style={m.color ? { color: m.color } : undefined}
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>
      <span className="flex shrink-0 items-center gap-0.5 text-body-sm font-semibold text-primary">
        {openLabel}
        <ChevronRight className="size-3.5" />
      </span>
    </div>
  );
}
