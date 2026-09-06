"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";

type FullScreenOverlayContextValue = {
  register: (id: string) => void;
  unregister: (id: string) => void;
};

const FullScreenOverlayContext = createContext<FullScreenOverlayContextValue | null>(null);
const FullScreenOverlayCountContext = createContext(0);

/**
 * Tracks how many task-tier `DialogContent`s are currently rendered full-screen on
 * mobile (the overlay chrome migration's `max-md:` treatment) — `BottomNav` hides
 * itself while any is open, rather than sitting underneath a full-screen form. You're
 * mid-task; tabbing away isn't a case worth preserving nav access for, and this beats a
 * pinned-footer/no-footer special case inside `DialogContent` itself.
 *
 * Mount once near the shell root (`AppShell`); `DialogContent` self-registers via
 * `useFullScreenOverlayRegistration` below. `SettingsModalShell`'s own mobile full-page
 * treatment is unaffected — it predates this migration and isn't built on `DialogContent`.
 *
 * Deliberately mounted in `AppShell`, not the root layout: routes outside it
 * (`/onboarding`, `/auth-error`) have no `BottomNav` to hide, so there's nothing for a
 * provider there to do. A `DialogContent` rendered outside `AppShell` (there shouldn't be
 * one) just no-ops, same as any other out-of-provider usage below.
 */
export function FullScreenOverlayProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<Set<string>>(new Set());

  const register = useCallback((id: string) => {
    setIds((prev) => {
      if (prev.has(id)) return prev;
      return new Set(prev).add(id);
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ register, unregister }), [register, unregister]);

  return (
    <FullScreenOverlayContext.Provider value={value}>
      <FullScreenOverlayCountContext.Provider value={ids.size}>
        {children}
      </FullScreenOverlayCountContext.Provider>
    </FullScreenOverlayContext.Provider>
  );
}

/** True while at least one full-screen-on-mobile `DialogContent` is open anywhere in
 *  the tree. Outside a `FullScreenOverlayProvider` (e.g. an isolated component test)
 *  this is always `false` — `BottomNav` itself is also usually absent in that case. */
export function useAnyFullScreenOverlayOpen(): boolean {
  return useContext(FullScreenOverlayCountContext) > 0;
}

/** Call unconditionally from a component that should count as an open full-screen
 *  overlay for as long as it's mounted with `active` true. Radix only mounts
 *  `Dialog.Content` while its `Root` is open (no `forceMount` here), so mount lifetime
 *  IS open lifetime — no separate `open` prop needed. No-ops outside a
 *  `FullScreenOverlayProvider`. */
export function useFullScreenOverlayRegistration(active: boolean) {
  const ctx = useContext(FullScreenOverlayContext);
  const id = useId();
  useEffect(() => {
    if (!active || !ctx) return;
    ctx.register(id);
    return () => ctx.unregister(id);
  }, [active, ctx, id]);
}
