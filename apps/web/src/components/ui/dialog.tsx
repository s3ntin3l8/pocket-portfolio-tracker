"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useFullScreenOverlayRegistration } from "@/components/full-screen-overlay";
import { SheetFooterChromeContext, SheetFooterContext } from "@/components/ui/sheet";

function Dialog({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  // Android hardware/gesture back closes the dialog instead of navigating the route.
  useBackToClose(open, onOpenChange);
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props} />;
}
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  fullScreenOnMobile,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & { fullScreenOnMobile: boolean }) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50",
        // A full-screen mobile overlay isn't a modal over other content — no scrim.
        // Matches SettingsModalShell's own mobile treatment (transparent below md,
        // scrim at md:+). Non-full-screen (confirms/pickers) always gets the scrim.
        fullScreenOnMobile ? "bg-transparent md:bg-black/50" : "bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

/** Desktop max-width per size tier — collapses six ad-hoc widths (448/480/600/860/1080/
 *  1120px) scattered across the pre-migration overlays down to four named ones. Each
 *  value is a complete, literal Tailwind class so the JIT scanner can find it regardless
 *  of which branch runs at build time — do not construct these via string interpolation. */
export type DialogSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: "md:max-w-[480px]", // confirms, small pickers, read-only detail
  md: "md:max-w-[600px]", // single-column forms
  lg: "md:max-w-[880px]", // forms with a summary/second column
  xl: "md:max-w-[1080px]", // rail + content shells
};

const SIZE_CLASS_STATIC: Record<DialogSize, string> = {
  sm: "max-w-[480px]",
  md: "max-w-[600px]",
  lg: "max-w-[880px]",
  xl: "max-w-[1080px]",
};

function DialogContent({
  className,
  children,
  hideClose = false,
  size = "sm",
  fullScreenOnMobile = true,
  mobileHeader,
  footer,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Suppress the built-in top-right close button — for shells that render their own
   *  close/back affordances in a custom header (mirrors `SheetContent`'s `hideClose`). */
  hideClose?: boolean;
  /** Desktop width tier — see the table on `SIZE_CLASS`. Has no effect on mobile when
   *  `fullScreenOnMobile` (mobile is always edge-to-edge there). */
  size?: DialogSize;
  /** Task-tier overlays (the default): full-screen with no scrim below `md`, a centered
   *  card at `size`'s width at `md:`+ — the desktop-modal/mobile-full-page split every
   *  migrated overlay uses. Set `false` for a small blocking confirm that should stay a
   *  centered card at every width (never takes over the screen) — see
   *  `confirm-action-dialog.tsx`. */
  fullScreenOnMobile?: boolean;
  /** Back-chevron + title row shown only in the mobile full-screen state, replacing the
   *  floating X there (matches `SectionHeader`'s look, reused by every full-page form).
   *  Desktop still gets the floating X (or nothing, if `hideClose`). No effect when
   *  `fullScreenOnMobile` is false. */
  mobileHeader?: { title: React.ReactNode };
  /** A persistent, non-scrolling footer — pinned flush to the safe area on mobile
   *  full-screen, an in-flow bottom bar on desktop. Provides `SheetFooterContext` with
   *  its own portal node, so a form already using `useSheetFooter()` (the pattern
   *  `desktop-shell.tsx` hand-rolls today) works unchanged inside this primitive. Omit
   *  for forms that render their own submit button inline (e.g. `portfolio-edit-form.tsx`,
   *  a real page with no sticky chrome of its own). Pass `true` for a footer that's
   *  just the portal slot with no static content of its own (e.g. a form whose own
   *  submit button self-portals via `useSheetFooter()`, like `AddTransactionForm`'s
   *  `SubmitButton`) — the bar still renders and provides the context, just with
   *  nothing alongside the portaled content. */
  footer?: React.ReactNode | true;
}) {
  // `!= null` also catches `null` (not just `undefined`) — a caller passing
  // `condition && <content/>` (a common React idiom) gets `null`, not `false`, when
  // `condition` is falsy, and that must not render an empty footer bar.
  const hasFooter = footer != null && footer !== false;
  const structured = Boolean(mobileHeader || hasFooter);
  const [footerEl, setFooterEl] = React.useState<HTMLDivElement | null>(null);

  // Registers only while mounted with fullScreenOnMobile — Radix only mounts
  // Dialog.Content while its Root is open (no forceMount here), so mount lifetime IS
  // open lifetime. BottomNav hides itself while any instance is registered — see the
  // hook's doc comment for why (a full-screen task overlay isn't a place to leave tab
  // navigation reachable).
  useFullScreenOverlayRegistration(fullScreenOnMobile);

  const body = structured ? (
    <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
  ) : (
    children
  );

  const content = hasFooter ? (
    <SheetFooterChromeContext.Provider value={true}>
      <SheetFooterContext.Provider value={footerEl}>{body}</SheetFooterContext.Provider>
    </SheetFooterChromeContext.Provider>
  ) : (
    body
  );

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay fullScreenOnMobile={fullScreenOnMobile} />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 border-border bg-card text-card-foreground shadow-lg",
          structured ? "flex flex-col" : "grid gap-4 overflow-y-auto",
          fullScreenOnMobile
            ? cn(
                // Mobile: full screen, no card chrome — a page, not a modal.
                "inset-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 shadow-none",
                // Desktop: centered card at the size tier's width.
                "md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:w-[calc(100%-2rem)] md:max-h-[88vh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[22px] md:border md:shadow-lg",
                !structured && "p-6",
                SIZE_CLASS[size],
              )
            : cn(
                // Always centered, never full-screen — blocking confirms/small pickers.
                "left-1/2 top-1/2 h-auto w-[calc(100%-2rem)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-xl border",
                !structured && "p-6",
                SIZE_CLASS_STATIC[size],
              ),
          className,
        )}
        {...props}
      >
        {fullScreenOnMobile && mobileHeader && (
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 md:hidden">
            <DialogPrimitive.Close
              aria-label="Back"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground"
            >
              <ChevronLeft className="size-[18px]" />
            </DialogPrimitive.Close>
            {/* Plain heading, not DialogTitle — Radix derives Title's id from the shared
                Dialog context, so a second Title here would duplicate the id the
                caller's own DialogTitle already renders. This is the visible mobile
                heading only; a caller using mobileHeader still owns the one accessible
                DialogTitle (a visually-hidden one is fine if it has no other use for it). */}
            <h1 className="min-w-0 truncate text-lg font-extrabold tracking-tight">
              {mobileHeader.title}
            </h1>
          </div>
        )}

        {content}

        {hasFooter && (
          <div
            data-slot="dialog-footer"
            className={cn(
              "flex shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-4 py-3",
              // In-flow, not fixed: the mobile full-screen container is already h-full
              // flex-col, so a shrink-0 last child sits flush at its bottom on its own —
              // a `fixed` footer here would leave the flex flow while the scrollable
              // body above it stays sized to the full viewport, hiding the body's own
              // last content behind the footer (the exact bug this migration fixes on
              // the selection bar, finding 4).
              fullScreenOnMobile && "max-md:pb-[env(safe-area-inset-bottom)]",
            )}
          >
            {footer !== true && footer}
            {/* display:contents so a portaled submit button (useSheetFooter) lands as a
                flex sibling of `footer` in DOM order, not visually nested in this div. */}
            <div ref={setFooterEl} className="contents" />
          </div>
        )}

        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              "absolute right-4 top-4 rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
              // The mobile header's own back-chevron already closes — don't show both.
              fullScreenOnMobile && mobileHeader && "max-md:hidden",
            )}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
