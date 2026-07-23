"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The v2 "ProfileSettings"/"Admin Settings" modal chrome — rendered by the `@modal`
 * intercepting-route slot's layouts (`app/[locale]/(app)/@modal/(.)settings/layout.tsx`,
 * `.../(.)admin/layout.tsx`). Desktop: a centered scrim + panel (max-width 1080px,
 * 88vh, 22px radius). Mobile: a full-screen takeover (no scrim/panel — `SettingsShell`
 * inside already handles the landing-vs-drill-in split for narrow viewports).
 *
 * This wraps the *existing* `SettingsShell` unchanged — the shell's rail/landing/content
 * logic doesn't know or care whether it's embedded in a full page (the real
 * `/settings/*` route, hit on direct load/refresh — SSR'd, deep-linkable, admin-gated
 * server-side) or this overlay (reached only via in-app client navigation, which Next's
 * route interception swaps in instead of a full navigation). Closing always calls
 * `router.back()` — matching the interception convention: the modal only exists because
 * *something* client-navigated here, so back() returns to that same place instead of
 * hard-coding a destination.
 *
 * Note: unlike `Dialog`/`Sheet` (JS-state overlays layered on top of an unrelated route),
 * this modal *is* a real route entry — Next pushed a new history entry for it when the
 * triggering `<Link>` was clicked, and intercepted what renders there. So plain
 * `router.back()` is already the correct, sufficient close mechanism here; no synthetic
 * history marker (`useBackToClose`, built for the JS-state case) is needed or safe to
 * layer on top of it — doing so would risk popping history twice.
 */
export function SettingsModalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const close = () => router.back();

  // Drives the entry transition (fade scrim + scale-up panel) and gates the outside-click
  // handler below — mounting `true` a tick after first paint gives the browser a frame to
  // render the pre-transition state before animating to it (an immediate `true` on mount
  // would just render already-transitioned, no animation).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Background scroll-lock — an open modal shouldn't let wheel/trackpad gestures scroll
  // the page underneath it. Restores whatever the body's own overflow was, not a bare ""
  // (in case something else on the page also manages it).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8 transition-opacity duration-200 max-md:p-0",
        entered ? "opacity-100" : "opacity-0",
      )}
      onClick={close}
    >
      <div
        className={cn(
          "flex h-full max-h-[88vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-[22px] border-0 bg-background shadow-[0_30px_80px_rgba(0,0,0,.4)] transition-[opacity,transform] duration-200 max-md:h-full max-md:max-h-none max-md:rounded-none",
          entered ? "scale-100 opacity-100" : "scale-95 opacity-0",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4 md:hidden">
          <h1 className="flex-1 truncate text-lg font-extrabold">{title}</h1>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-card text-foreground shadow-[0_1px_2px_rgba(15,27,20,.08)]"
          >
            <X className="size-[18px]" strokeWidth={2.2} />
          </button>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-8 top-8 hidden size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-card text-foreground shadow-[0_1px_2px_rgba(15,27,20,.08)] md:flex"
        >
          <X className="size-[18px]" strokeWidth={2.2} />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">{children}</div>
      </div>
    </div>
  );
}
