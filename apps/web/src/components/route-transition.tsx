"use client";

import { useEffect, useState, ViewTransition } from "react";
import { usePathname } from "@/i18n/navigation";

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

  useEffect(() => {
    scrollContainerRef.current?.scrollTo(0, 0);
  }, [transitionKey, scrollContainerRef]);

  return (
    <ViewTransition key={transitionKey} enter="vt-route" exit="vt-route" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
