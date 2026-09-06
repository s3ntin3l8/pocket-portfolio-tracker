"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

/**
 * The refinement tier's desktop chrome — anchored to its trigger, doesn't take over the
 * screen, closes on outside-click/Escape but not on clicks to its own content (unlike
 * DropdownMenu's Item, nothing here auto-selects-and-closes). Pairs with `Sheet` for the
 * same refinement's mobile chrome: `Popover` at `md:`+, a compact `Sheet` below it — see
 * `kpi-picker-sheet.tsx` for the pattern. Not for task-tier content; that's
 * `DialogContent`.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = "end",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
