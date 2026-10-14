import { cn } from "@/lib/utils";

/** Classes for a full-width selectable card (tax regime, cash treatment): a 1.5px border
 *  that turns primary when selected, plus a light primary wash (stronger in dark). */
export function choiceCardClass(selected: boolean): string {
  return cn(
    "block w-full cursor-pointer rounded-lg border-[1.5px] px-4 py-[15px] text-left transition-colors",
    selected ? "border-primary bg-primary/6 dark:bg-primary/14" : "border-border bg-card",
  );
}
