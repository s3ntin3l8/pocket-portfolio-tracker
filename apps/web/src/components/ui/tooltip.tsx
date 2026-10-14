"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/** Supplies the shared open-delay; each `Tooltip` mounts its own so no layout wiring is needed. */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
}

/**
 * Hover/focus tooltip (Radix). Unlike a native `title=`, it opens on keyboard focus and is
 * linked to its trigger via `aria-describedby`. Tapping a focusable trigger focuses it, which
 * opens the tip on touch devices as well.
 */
function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-md animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/**
 * `<InfoTip label="…"><Badge/></InfoTip>`: the child becomes the trigger. Pass `focusable` for a
 * non-interactive child (badge, plain text) so it is reachable by keyboard and tap.
 */
function InfoTip({
  label,
  children,
  focusable = false,
  side,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  focusable?: boolean;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
}) {
  const child = focusable
    ? React.cloneElement(children as React.ReactElement<{ tabIndex?: number }>, { tabIndex: 0 })
    : children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{child}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, InfoTip };
