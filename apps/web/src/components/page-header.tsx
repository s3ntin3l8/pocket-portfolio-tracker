"use client";

import { createContext, useContext, useEffect, useState } from "react";
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
 * Renders the page's <h1> on mobile (hidden on desktop where the topbar owns it).
 */
export function PageTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <h1 className={cn("text-2xl font-bold md:hidden", className)}>{children}</h1>;
}

/** Read the current page header state (used by AppShell). */
export function usePageHeader() {
  return useContext(PageHeaderContext);
}
