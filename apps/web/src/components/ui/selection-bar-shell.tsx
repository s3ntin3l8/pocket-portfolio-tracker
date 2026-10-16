"use client";

import { InfoTip } from "@/components/ui/tooltip";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullScreenOverlayRegistration } from "@/components/full-screen-overlay";

/**
 * Shared chrome for a contextual batch-action bar (row selection mode) — used by both
 * `transactions-table/selection-bar.tsx` and `import-history/selection-bar.tsx`, which
 * differ only in which actions they offer.
 *
 * Desktop (`md:`+): an inline card in the normal document flow, sticky under the top bar.
 *
 * Mobile: a fixed bottom bar that *replaces* BottomNav rather than floating on top of
 * it. `BottomNav` hides itself via the same `useFullScreenOverlayRegistration` this
 * calls below (selection mode is mid-task chrome, same principle a full-screen
 * `DialogContent` uses it for) — so there's no still-visible nav underneath to clear,
 * and no `safe-area-bottom` class (previously used here, but undefined anywhere in the
 * stylesheet — a silent no-op) needed to fake it. This component owns the bottom edge
 * outright while mounted, same as `BottomNav` does the rest of the time.
 */
export function SelectionBarShell({
  label,
  onDismiss,
  dismissLabel,
  className,
  children,
}: {
  label: React.ReactNode;
  onDismiss: () => void;
  dismissLabel: string;
  className?: string;
  /** The actions row — right-aligned when it fits, scrolls from its start when it doesn't
   *  (`justify-end` would clip the overflowing start, unreachable by scrolling) — omitted (no empty action tray) when there's nothing to show. */
  children?: React.ReactNode;
}) {
  useFullScreenOverlayRegistration(true);

  return (
    <div
      className={cn(
        "flex min-h-12 items-center justify-between gap-3 border-border bg-card/60 px-4 py-2 text-sm",
        "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:mb-0 max-md:z-30 max-md:min-h-14 max-md:rounded-none max-md:border-t max-md:bg-background/95 max-md:px-4 max-md:py-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:shadow-lg max-md:backdrop-blur-sm",
        // Inline on md+, but stuck under the top bar (`--topbar-h`) so a long list can scroll past
        // without losing the batch actions.
        "md:sticky md:top-[calc(var(--topbar-h)+0.5rem)] md:z-20 md:rounded-lg md:border md:shadow-sm",
        className,
      )}
    >
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <InfoTip label={dismissLabel}>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            className="flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground max-md:-ml-2.5 md:size-8"
          >
            <X className="size-4" />
          </button>
        </InfoTip>
        {label}
      </span>
      {children && (
        <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5 overflow-x-auto pb-0.5 [&>:first-child]:ml-auto [scrollbar-width:none] md:overflow-visible [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      )}
    </div>
  );
}
