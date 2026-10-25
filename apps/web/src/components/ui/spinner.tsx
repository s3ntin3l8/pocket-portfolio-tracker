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
 * The generic busy-state name, used when the component is rendered without the intl
 * provider (the app always mounts it; an isolated render falls back to this).
 */
const FALLBACK_LABEL = "Loading…";

/**
 * The localized busy-state name.
 *
 * `useTranslations` needs the intl provider and throws without it, so the lookup is
 * guarded. The provider is mounted for the whole app, so it is either always present
 * or always missing for a given tree — the hook order never changes between renders
 * of the same component, which is what the rule protects. The fallback keeps the
 * spinner usable in an isolated render (a test that mounts it on its own).
 */
function useSpinnerLabel(): string {
  let label = FALLBACK_LABEL;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- guarded lookup; the provider's presence is fixed per tree (see above)
    label = useTranslations("A11y")("loading");
  } catch {
    // No intl provider in this render — keep the plain English fallback.
  }
  return label;
}

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
  const defaultLabel = useSpinnerLabel();
  return (
    <Loader2
      role="status"
      aria-label={label ?? defaultLabel}
      className={cn("animate-spin text-primary", SIZES[size], className)}
      {...props}
    />
  );
}

export { Spinner };
