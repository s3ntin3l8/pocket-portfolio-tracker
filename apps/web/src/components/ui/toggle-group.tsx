"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

/**
 * Single-select segmented control (Radix): a `role="group"` of `role="radio"` items with
 * `aria-checked`. Deselecting the active item is ignored (a range/theme picker always has a
 * value), so `onValueChange` only fires with a real new value.
 */
function ToggleGroup<T extends string>({
  value,
  onValueChange,
  className,
  ...props
}: Omit<
  React.ComponentProps<typeof ToggleGroupPrimitive.Root>,
  "type" | "value" | "defaultValue" | "onValueChange"
> & { value: T; onValueChange: (value: T) => void }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v as T);
      }}
      className={cn("flex", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
