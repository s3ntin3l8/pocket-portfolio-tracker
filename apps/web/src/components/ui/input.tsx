import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex w-full rounded-[13px] border border-border bg-card px-3.5 py-[13px] text-sm font-medium text-foreground transition-colors placeholder:text-text-3 focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
