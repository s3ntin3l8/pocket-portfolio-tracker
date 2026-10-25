"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-3.5",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
  xl: "size-7",
} as const;

/**
 * A spinner is a busy state, and a bare icon says nothing to a screen reader (lucide
 * hard-codes `aria-hidden` on its icons, so the icon alone is never announced). The
 * spinner therefore carries `role="status"` and an accessible name by default —
 * `aria-label` also tells lucide not to mark the icon `aria-hidden` (audit R4-D9).
 */
function Spinner({
  size = "md",
  label,
  className,
  ...props
}: React.ComponentProps<"svg"> & { size?: keyof typeof SIZES; label?: string }) {
  const t = useTranslations("A11y");
  return (
    <Loader2
      role="status"
      aria-label={label ?? t("loading")}
      className={cn("animate-spin text-primary", SIZES[size], className)}
      {...props}
    />
  );
}

export { Spinner };
