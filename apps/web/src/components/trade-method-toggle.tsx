"use client";

import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface Props {
  current: "average" | "fifo";
  labelAverage: string;
  labelFifo: string;
  /** Accessible name for the radio group. */
  "aria-label"?: string;
}

/**
 * Average ↔ FIFO cost-basis toggle, driven by the `?method=` search param (server re-render).
 *
 * Built on the shared `ui/toggle-group` primitive (a Radix `ToggleGroup`), so the control is
 * a real radio group: the group carries `role="radiogroup"`, the active option carries
 * `aria-checked="true"` and the others `false`, and the group is a single tab stop with
 * arrow-key navigation between the options.
 */
export function TradeMethodToggle({
  current,
  labelAverage,
  labelFifo,
  "aria-label": ariaLabel,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const href = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("method", value);
    return `${pathname}?${params.toString()}`;
  };

  function select(value: "average" | "fifo") {
    if (value === current) return;
    router.push(href(value));
  }

  const active = "bg-background text-foreground shadow-sm";
  const inactive = "text-muted-foreground hover:text-foreground";

  return (
    <ToggleGroup
      value={current}
      onValueChange={(v) => select(v as "average" | "fifo")}
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-lg border border-border bg-muted p-1 text-sm font-medium"
    >
      <ToggleGroupItem
        value="average"
        className={cn(
          "touch-target relative rounded-md px-3 py-1 transition-colors",
          current === "average" ? active : inactive,
        )}
      >
        {labelAverage}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="fifo"
        className={cn(
          "touch-target relative rounded-md px-3 py-1 transition-colors",
          current === "fifo" ? active : inactive,
        )}
      >
        {labelFifo}
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
