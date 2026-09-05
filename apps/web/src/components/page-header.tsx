"use client";

import { createContext, useCallback, useContext, useState } from "react";

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

  const handleSetTitle = useCallback((t: string | null) => setTitle(t), []);
  const handleSetBackHref = useCallback((h: string | null) => setBackHref(h), []);

  return (
    <PageHeaderDispatchContext.Provider
      value={{ setTitle: handleSetTitle, setBackHref: handleSetBackHref }}
    >
      <PageHeaderContext.Provider value={{ title, backHref }}>
        {children}
      </PageHeaderContext.Provider>
    </PageHeaderDispatchContext.Provider>
  );
}

/**
 * Declares the page title and optional back-link for the desktop topbar.
 * Place this inside any page that should show a title in the topbar.
 */
export function PageHeaderSetter({
  title,
  backHref = null,
}: {
  title: string;
  backHref?: string | null;
}) {
  const { setTitle, setBackHref } = useContext(PageHeaderDispatchContext);
  setTitle(title);
  setBackHref(backHref);
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
  return <h1 className={`text-2xl font-bold md:hidden ${className ?? ""}`}>{children}</h1>;
}

/** Read the current page header state (used by AppShell). */
export function usePageHeader() {
  return useContext(PageHeaderContext);
}
