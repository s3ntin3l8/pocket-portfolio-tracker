"use client";

import { useEffect, useRef, useState, ViewTransition } from "react";
import { usePathname } from "@/i18n/navigation";

/**
 * Move focus to the new page after a route change, so a keyboard or screen-reader user
 * continues from the new content instead of from the link that was just replaced (or from
 * the top of the document).
 *
 * The target is the page's `<h1>`, falling back to the app shell's `<main>`. A heading is
 * not focusable by default, so `tabindex="-1"` is added to the element we focus — the page
 * header is shared by every page and has no business owning a focus-management detail
 * (the shell's `<main>` already carries that attribute).
 */
function focusPageHeading(root: HTMLElement | null) {
  const heading =
    root?.querySelector<HTMLElement>("h1") ?? document.querySelector<HTMLElement>("h1");
  const target = heading ?? document.querySelector<HTMLElement>("main");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  // The scroll container was just reset to the top — don't let the focus jump scroll it.
  target.focus({ preventScroll: true });
}

/**
 * Cross-fades route changes with React's `<ViewTransition>` (browser View Transitions API).
 * Keyed by pathname, so only a real route change enters/exits it: query-only changes
 * (`?scope=`) keep the key, and the shallow `history.replaceState` writes for range/year
 * never reach React at all. Router navigations are React transitions, which is what
 * activates the animation; `default="none"` keeps unrelated updates from crossfading the
 * whole page. Progressive enhancement: browsers without the API (or users with
 * `prefers-reduced-motion`, see globals.css) just get the instant swap. `<AppShell>` stays
 * mounted across navigations and only `<main>`'s children swap.
 */
export function RouteTransition({
  children,
  scrollContainerRef,
}: {
  children: React.ReactNode;
  /**
   * AppShell's scrollable div — a custom element, not `window`/`document`, so
   * Next's built-in scroll-restoration doesn't reach it (#584). Reset it to the
   * top on every route change so navigating in doesn't leave the new page's
   * header scrolled out of view.
   */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const pathname = usePathname();

  const [prevPathname, setPrevPathname] = useState(pathname);
  const [transitionKey, setTransitionKey] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setTransitionKey(pathname);
  }

  const containerRef = useRef<HTMLDivElement>(null);
  /** The transition key we already handled — `null` until the first paint. */
  const handledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
    if (handledKeyRef.current === null) {
      // First paint: the page is already the right one — never steal focus on load.
      handledKeyRef.current = transitionKey;
      return;
    }
    if (handledKeyRef.current === transitionKey) return;
    handledKeyRef.current = transitionKey;
    // A route change settled: hand the keyboard over to the new page.
    focusPageHeading(containerRef.current);
  }, [transitionKey, scrollContainerRef]);

  return (
    <ViewTransition key={transitionKey} enter="vt-route" exit="vt-route" default="none">
      <div ref={containerRef}>{children}</div>
    </ViewTransition>
  );
}
