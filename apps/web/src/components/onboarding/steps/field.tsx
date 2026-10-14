import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Input skin on the mobile dark brand surface: a frosted glass field instead of the
 *  opaque `bg-card` (the surface behind it is the brand gradient there). */
export const GLASS_INPUT =
  "max-md:dark:border-white/14 max-md:dark:bg-white/5 max-md:dark:backdrop-blur-[3px]";

export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <label className={cn("mx-0.5 mb-1.5 block text-xs font-semibold text-text-mute", className)}>
      {children}
    </label>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="mx-0.5 mt-1.5 text-micro font-medium text-destructive">{children}</p>;
}
