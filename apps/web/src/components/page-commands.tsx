"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

/** What a page command's `run` gets: the palette's own `navigate` (closes the palette,
 *  suppresses its back-press cleanup, then push/replace) and a bare `close` for commands
 *  that don't route (e.g. a shallow `history.replaceState` write). */
export interface PageCommandNav {
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  close: () => void;
}

export interface PageCommandItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Extra text the palette filter also matches against. */
  keywords?: string;
  run: (nav: PageCommandNav) => void;
}

export interface PageCommandGroup {
  id: string;
  heading: string;
  items: PageCommandItem[];
}

interface Registry {
  groups: PageCommandGroup[];
  register: (group: PageCommandGroup) => () => void;
}

// The default (no provider) is an empty list, so `GlobalSearch` keeps working outside
// `AppShell` — same approach as `useAssistant`.
const EMPTY: Registry = { groups: [], register: () => () => {} };
const Ctx = createContext<Registry>(EMPTY);

/** Holds the page-contributed command groups the palette renders. Pages register through
 *  `useRegisterPageCommands`; a group lives exactly as long as its registering component. */
export function PageCommandsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<ReadonlyMap<string, PageCommandGroup>>(new Map());

  // Consumers can unmount after the provider does (route transition); their cleanup must
  // not push state into a dead provider.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const register = useCallback((group: PageCommandGroup) => {
    setMap((prev) => new Map(prev).set(group.id, group));
    // Only remove our own entry: with a duplicate id the later registration wins, and the
    // earlier owner unmounting must not take the newer group down with it.
    return () => {
      if (!mounted.current) return;
      setMap((prev) => {
        if (prev.get(group.id) !== group) return prev;
        const next = new Map(prev);
        next.delete(group.id);
        return next;
      });
    };
  }, []);

  const value = useMemo<Registry>(() => ({ groups: [...map.values()], register }), [map, register]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The active page groups (empty outside the provider). */
export function usePageCommands(): PageCommandGroup[] {
  return useContext(Ctx).groups;
}

/**
 * Register a command group for the lifetime of the calling component. The effect is keyed
 * on the group id plus a serialization of the item ids/labels/keywords — not array
 * identity — and every `run` goes through a ref to the latest props, so a re-render with
 * equal-but-new items never re-registers (no loop, no flicker) yet a command always sees
 * current URL state. Item order is part of the signature, so a caller that reorders its
 * items re-registers; keep the order stable across renders.
 */
export function useRegisterPageCommands(group: PageCommandGroup): void {
  const { register } = useContext(Ctx);
  const latest = useRef(group);
  // Deliberately dependency-less: it must run after every render, and before the
  // registration effect below (effects run in declaration order), so `run` always sees the
  // latest closure. Adding `[group]` here would break that invariant.
  useEffect(() => {
    latest.current = group;
  });

  const signature = JSON.stringify([
    group.id,
    group.heading,
    group.items.map((i) => [i.id, i.label, i.keywords ?? "", i.icon?.displayName ?? ""]),
  ]);

  useEffect(() => {
    const stable: PageCommandGroup = {
      id: latest.current.id,
      heading: latest.current.heading,
      items: latest.current.items.map((item) => ({
        ...item,
        run: (nav) => latest.current.items.find((i) => i.id === item.id)?.run(nav),
      })),
    };
    return register(stable);
  }, [register, signature]);
}
