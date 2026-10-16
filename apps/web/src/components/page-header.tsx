"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { BackLink } from "@/components/back-button";
import { useIsShellIndex } from "@/components/section-heading-context";
import { cn } from "@/lib/utils";

type PageHeaderState = {
  title: string | null;
  backHref: string | null;
};

const PageHeaderContext = createContext<PageHeaderState>({
  title: null,
  backHref: null,
});

const PageHeaderDispatchContext = createContext<{
  setTitle: (title: string | null) => void;
  setBackHref: (href: string | null) => void;
}>({
  setTitle: () => {},
  setBackHref: () => {},
});

export function PageHeaderProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const [backHref, setBackHref] = useState<string | null>(null);

  return (
    <PageHeaderDispatchContext.Provider value={{ setTitle, setBackHref }}>
      <PageHeaderContext.Provider value={{ title, backHref }}>
        {children}
      </PageHeaderContext.Provider>
    </PageHeaderDispatchContext.Provider>
  );
}

/**
 * Declares the page title and optional back-link for the desktop topbar.
 * Place this inside any page that should show a title in the topbar.
 * Clears its values on unmount so routes without a setter (or before
 * one mounts) don't show a stale title from the previous page.
 */
export function PageHeaderSetter({
  title,
  backHref = null,
}: {
  title: string;
  backHref?: string | null;
}) {
  const { setTitle, setBackHref } = useContext(PageHeaderDispatchContext);
  useEffect(() => {
    setTitle(title);
    setBackHref(backHref);
    return () => {
      setTitle(null);
      setBackHref(null);
    };
  }, [title, backHref, setTitle, setBackHref]);
  return null;
}

/**
 * The one page header. Sets the desktop topbar title (and back chevron) and renders the page's
 * single <h1>, which is visible on mobile and screen-reader-only from `md` up, where the topbar
 * shows the title. On mobile a back button sits left of the title when `backHref` is given; an
 * optional subtitle sits under the title and an optional `action` (e.g. Export) is right-aligned
 * (second row on narrow screens).
 *
 * - `mobileTitle`: shorter title for narrow screens (the topbar keeps `title`).
 * - `desktopBack={false}`: keep the mobile back link but show no chevron in the topbar (the
 *   settings/admin landing pages).
 * - Inside the settings shell index the shell owns the <h1>, so this renders an <h2> there.
 * - A page with a subtitle or action keeps its bottom margin on desktop; a bare title does not,
 *   since the topbar already carries it.
 */
export function PageHeader({
  title,
  mobileTitle,
  subtitle,
  backHref,
  backLabel,
  action,
  desktopBack = true,
  className,
}: {
  title: string;
  mobileTitle?: string;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
  desktopBack?: boolean;
  className?: string;
}) {
  const isShellIndex = useIsShellIndex();
  const Heading = isShellIndex ? "h2" : "h1";
  const hasExtras = Boolean(subtitle || action);
  return (
    <>
      <PageHeaderSetter title={title} backHref={desktopBack ? (backHref ?? null) : null} />
      <div
        className={cn(
          hasExtras ? "mb-6" : "mb-4 md:mb-0",
          action
            ? "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 md:flex md:items-center"
            : "flex items-center gap-3",
          className,
        )}
      >
        {backHref && <BackLink href={backHref} label={backLabel} />}
        <div className="min-w-0 flex-1">
          <Heading className="truncate text-heading font-semibold md:sr-only">
            {mobileTitle ? (
              <>
                <span className="sm:hidden">{mobileTitle}</span>
                <span className="hidden sm:inline">{title}</span>
              </>
            ) : (
              title
            )}
          </Heading>
          {subtitle && (
            <p className={cn("text-sm text-text-2", typeof subtitle === "string" && "truncate")}>
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="col-start-2 row-start-2 justify-self-end md:ml-auto">{action}</div>
        )}
      </div>
    </>
  );
}

/**
 * The page's single <h1>, for headers that sit inside a custom layout (the instrument hero). Visible on mobile; from `md` up the desktop topbar shows the
 * title visually (as a plain paragraph, via `PageHeaderSetter`), so the <h1> stays in the
 * accessibility tree but is screen-reader-only there. NOT `md:hidden`: that would leave
 * the document without any heading on desktop.
 */
export function PageTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <h1 className={cn("text-heading font-semibold md:sr-only", className)}>{children}</h1>;
}

/** Read the current page header state (used by AppShell). */
export function usePageHeader() {
  return useContext(PageHeaderContext);
}
