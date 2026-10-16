import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScopeLink } from "@/components/scope-link";
import { cn } from "@/lib/utils";

/**
 * The one back-button look: a 36px bordered card-surface square with a chevron. `before:`
 * pads the tap target out to ~44px (the touch-target minimum) without affecting layout.
 * Use `BackLink` for a route back; use this class + `BackIcon` for a custom element (a
 * dialog close, a step-back button).
 */
export const BACK_BUTTON_CLASS =
  "relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors before:absolute before:-inset-1 hover:bg-accent active:scale-95";

export function BackIcon() {
  return <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />;
}

/** A scope-preserving link back to `href`. Hidden from `md` up by default, where the desktop
 *  topbar owns the back affordance; pass `className="md:flex"` to keep it. */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  /** Accessible name; defaults to the shared "Back". */
  label?: string;
  className?: string;
}) {
  const tA = useTranslations("A11y");
  return (
    <ScopeLink
      href={href}
      aria-label={label ?? tA("back")}
      className={cn(BACK_BUTTON_CLASS, "md:hidden", className)}
    >
      <BackIcon />
    </ScopeLink>
  );
}
