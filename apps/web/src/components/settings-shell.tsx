"use client";

import { ChevronRight } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export interface ShellNavItem {
  key: string;
  href: string;
  /** A rendered icon element (e.g. `<UserRound />`), not a component reference —
   *  these items cross a server/client boundary and bare component references
   *  aren't serializable across it. Sized via the wrapper spans below. */
  icon: React.ReactNode;
  title: string;
  /** Shown under the title in the mobile landing row; omitted on the desktop rail. */
  subtitle?: string;
  color: string;
  bg: string;
  /** Small uppercase pill next to the title (e.g. "ADMIN"). */
  badge?: string;
  /** Hides this item from the desktop rail (but keeps it in mobile landing). */
  hideFromRail?: boolean;
}

const CARD_SHADOW = "shadow-card";

/**
 * Shared master-detail shell for `/settings/*` and `/admin/*`: a sticky left rail of
 * section links on desktop, beside a content pane; a grouped landing menu on mobile at
 * the tree's exact index route, which drills into `children` (the current route's own
 * page content) on any sub-route. Real Next.js routing throughout — no client-side
 * view-switching state — so this stays a thin nav wrapper around server-rendered pages.
 *
 * `groups` controls only the mobile landing's card grouping (each group renders as its
 * own bordered list); the desktop rail always renders every item as one flat list.
 *
 * `railVariant` picks between two distinct desktop rail designs from the mocks — they're
 * genuinely different, not a style nudge, so this is a real branch rather than a token
 * swap: `"cards"` (default, `ProfileSettings.dc.html`) is a 270px column of stacked
 * rounded `bg-card` cards with a `›` chevron per row; `"flush"` (`Admin Settings.dc.html`)
 * is a 250px `bg-card-2` sidebar flush against a `border-r`, no per-item card or chevron.
 */
export function SettingsShell({
  navItems,
  groups,
  indexHref,
  railVariant = "cards",
  railTop,
  railBottom,
  railExtra,
  mainHeader,
  landingTop,
  landingBottom,
  landingExtra,
  children,
}: {
  navItems: ShellNavItem[];
  /** Mobile landing grouping; defaults to a single group of all `navItems`. */
  groups?: ShellNavItem[][];
  indexHref: string;
  /** Desktop rail chrome — see the doc comment above. Defaults to `"cards"`. */
  railVariant?: "cards" | "flush";
  railTop?: React.ReactNode;
  railBottom?: React.ReactNode;
  /** Rendered inside the desktop rail's nav list, after every mapped `navItems` link
   *  (including any pushed after the initial list, e.g. Admin) — for action rows that
   *  aren't a plain link, such as the PWA install button. */
  railExtra?: React.ReactNode;
  /** Sticky header rendered above `children` in the main column, desktop-only — for a
   *  static banner that doesn't vary per section (e.g. Admin's "Administration · Server
   *  configuration · admins only"). Unlike `landingTop`, this shows on every route, not
   *  just the bare index. Omit for shells that don't have one (e.g. `/settings`, whose
   *  per-section title instead comes from each page's own `SectionHeader`). */
  mainHeader?: React.ReactNode;
  landingTop?: React.ReactNode;
  /** Rendered at the bottom of the mobile landing (the rail's `railBottom` is desktop-only). */
  landingBottom?: React.ReactNode;
  /** Rendered as its own trailing group on the mobile landing, after every group in
   *  `groups` — the landing counterpart to `railExtra`. */
  landingExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isIndex = pathname === indexHref;
  const match = navItems.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  // Mirrors the design's `section || (isDesktop ? "account" : null)` default: at the bare
  // index route, the first nav item's content is what's actually being shown (see the
  // section's own page delegating to the same content component as its first sub-route).
  const activeKey = match?.key ?? (isIndex ? navItems[0]?.key : undefined);

  const landingGroups = groups ?? (navItems.length > 0 ? [navItems] : []);
  const flush = railVariant === "flush";

  const railLinks = navItems
    .filter((item) => !item.hideFromRail)
    .map((item) => {
      const active = item.key === activeKey;
      return (
        <Link
          key={item.key}
          href={item.href}
          className={cn(
            "flex items-center gap-2.5 rounded-[12px] px-2.5 py-2.5 text-[13px] font-bold transition-colors",
            flush ? "my-px" : "my-0.5",
            active ? "bg-background" : "hover:bg-background/60",
          )}
        >
          <span
            className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] [&>svg]:size-4"
            style={{ background: item.bg, color: item.color }}
          >
            {item.icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
          {item.badge && (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-primary">
              {item.badge}
            </span>
          )}
          {!flush && <ChevronRight className="size-4 shrink-0 text-text-3" />}
        </Link>
      );
    });

  return (
    <div
      className={cn(
        "md:grid md:items-start",
        flush ? "md:grid-cols-[250px_1fr]" : "md:grid-cols-[270px_1fr] md:gap-6",
      )}
    >
      {flush ? (
        // No explicit height/overflow: unlike the mock's fixed 88vh modal panel, this
        // shell also mounts in normal page flow (the real, non-modal `/admin` route) where
        // a viewport-height rail would fight natural scrolling. `sticky top-4 self-start`
        // (same as the "cards" rail) keeps it in view without assuming a bounded ancestor.
        <div className="hidden md:sticky md:top-4 md:flex md:flex-col md:gap-0.5 md:self-start md:border-r md:border-border md:bg-card-2 md:p-3">
          {railTop}
          {railLinks}
          {railExtra}
          {railBottom}
        </div>
      ) : (
        <div className="hidden md:sticky md:top-4 md:flex md:flex-col md:gap-3 md:self-start">
          {railTop}
          <nav className={cn("rounded-[18px] bg-card p-2", CARD_SHADOW)}>
            {railLinks}
            {railExtra}
          </nav>
          {railBottom}
        </div>
      )}

      <div className="min-w-0">
        {isIndex && (
          <div className="space-y-4 md:hidden">
            {landingTop}
            {landingGroups.map((group, i) => (
              <div
                key={`group-${i}`}
                className={cn(
                  "divide-y divide-line overflow-hidden rounded-[20px] bg-card",
                  CARD_SHADOW,
                )}
              >
                {group.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50"
                  >
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl [&>svg]:size-[18px]"
                      style={{ background: item.bg, color: item.color }}
                    >
                      {item.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold">{item.title}</span>
                        {item.badge && (
                          <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-primary">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <div className="truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            ))}
            {landingExtra && (
              <div
                className={cn(
                  "divide-y divide-line overflow-hidden rounded-[20px] bg-card",
                  CARD_SHADOW,
                )}
              >
                {landingExtra}
              </div>
            )}
            {landingBottom}
          </div>
        )}

        {mainHeader && (
          // Deliberately not edge-to-edge (the mock bleeds this to the panel's own edges):
          // this shell is mounted with different ambient padding in its two hosts (the
          // modal's `md:p-6` vs. the real page's `<main>` `sm:px-6 sm:pt-6`) — both happen
          // to agree on 24px top padding at `md:` (the only breakpoint this renders at),
          // which `-mt-6`/`pt-6` cancels so the sticky header's top edge lands flush with
          // the scroll container's own top rather than fighting two different padding
          // scales with a bleed tuned for just one of them.
          <div className="sticky top-0 z-[5] -mt-6 mb-4 hidden border-b border-border bg-background pb-[18px] pt-6 md:block">
            {mainHeader}
          </div>
        )}

        <div className={isIndex ? "hidden md:block" : ""}>{children}</div>
      </div>
    </div>
  );
}
