"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Scroll wrapper for a table with a sticky header. `position: sticky` is lost inside any scroll
 * container, so while the table fits its column the wrapper clips (`overflow-x: clip`, no scroll
 * container) and the header sticks to the shell's scroller. As soon as the table is wider than
 * its column (a narrow viewport next to the rail) it falls back to a scrolling wrapper with the
 * edge shadows (`scroll-shadow-x`), so every column stays reachable and visibly so; the header then
 * scrolls with the page instead of pinning. The table's grid column must keep `min-w-0`, or `clip`
 * would let the track grow instead of the table overflowing.
 */
export function StickyTableWrapper({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const table = el?.firstElementChild;
    if (!el || !table) return;
    const measure = () => setFits(table.scrollWidth <= el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative w-full", fits ? "overflow-x-clip" : "scroll-shadow-x", className)}
    >
      {children}
    </div>
  );
}
