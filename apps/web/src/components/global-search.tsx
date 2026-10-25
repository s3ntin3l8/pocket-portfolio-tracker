"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Briefcase,
  CircleHelp,
  Clock,
  Sparkles,
  Layers,
  Moon,
  Plus,
  Search,
  Sun,
  Upload,
  Users,
} from "lucide-react";
import type {
  AccountHolder,
  GlobalSearchResult,
  Portfolio,
  SearchInstrumentResult,
  SearchTransactionResult,
} from "@portfolio/api-client";
import { useApiClient } from "@/lib/api";
import { suppressNextHistoryBack } from "@/lib/back-to-close-stack";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { COMMAND_PAGES } from "@/components/nav-items";
import { SCOPE_RESET_PARAMS } from "@/components/portfolio-switcher";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { useScopedHref } from "@/components/scope-link";
import { usePageCommands } from "@/components/page-commands";
import {
  SCOPE_PARAM,
  formatScopeParam,
  persistScopeCookie,
  type ScopeSelection,
} from "@/lib/portfolio-selection";
import { readRecentPages } from "@/lib/recent-pages";
import { readRecentInstruments, type RecentInstrument } from "@/lib/recent-instruments";
import { readShortcutsEnabled } from "@/lib/shortcut-preference";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { CHORD_TIMEOUT_MS, GO_CHORDS, shouldIgnoreShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

/** Case-insensitive substring match; an empty query matches everything. */
function matches(label: string, query: string): boolean {
  return !query || label.toLowerCase().includes(query.toLowerCase());
}

export function GlobalSearch({
  holderId,
  isAdmin = false,
}: {
  holderId?: string | null;
  isAdmin?: boolean;
}) {
  const t = useTranslations("Search");
  const tNav = useTranslations("Nav");
  const locale = useLocale();
  const client = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scoped = useScopedHref();
  const { resolvedTheme, setTheme } = useTheme();
  const assistant = useAssistant();
  const pageGroups = usePageCommands();

  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [results, setResults] = useState<GlobalSearchResult | null>(null);
  const [scopes, setScopes] = useState<{ portfolios: Portfolio[]; holders: AccountHolder[] }>({
    portfolios: [],
    holders: [],
  });
  const [recent, setRecent] = useState<string[]>([]);
  const [recentInstruments, setRecentInstruments] = useState<RecentInstrument[]>([]);

  // Debounce timer + stale-response guard.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef<string>("");
  const scopesLoadedRef = useRef(false);

  // Clear the pending search when the component goes away. A debounce timer that
  // outlives the component fires into a torn-down environment: it updates state after
  // unmount, and in the test suite it raises an unhandled "window is not defined" that
  // fails the whole run — a flake that has nothing to do with the test that ran last.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  // Reset state when palette closes.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults(null);
      setLoading(false);
      setError(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }

  // On open: read the recent-pages list and (once) load the scope choices. Both are
  // best-effort — the palette works without them.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecentPages());
    setRecentInstruments(readRecentInstruments());
    if (scopesLoadedRef.current) return;
    scopesLoadedRef.current = true;
    void (async () => {
      try {
        const [portfolios, holders] = await Promise.all([
          client.listPortfolios(),
          client.listAccountHolders(),
        ]);
        setScopes({ portfolios, holders });
      } catch {
        scopesLoadedRef.current = false;
      }
    })();
    // Keyed on `open` only: the client object is not guaranteed referentially stable, and
    // re-running this on every render would loop through `setRecent`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced search with stale-response guard.
  const runSearch = useCallback(
    (q: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const trimmed = q.trim();
      if (!trimmed) {
        setLoading(false);
        setError(false);
        setResults(null);
        return;
      }
      setLoading(true);
      setError(false);
      latestQueryRef.current = trimmed;
      timerRef.current = setTimeout(async () => {
        try {
          const data = await client.globalSearch({
            q: trimmed,
            holderId: holderId ?? undefined,
            limit: 10,
          });
          // Drop stale responses.
          if (latestQueryRef.current !== trimmed) return;
          setResults(data);
        } catch {
          // Surface the failure instead of silently leaving an empty list — otherwise
          // a 500 / network blip is indistinguishable from "no matches".
          if (latestQueryRef.current === trimmed) {
            setError(true);
            setResults(null);
          }
        } finally {
          if (latestQueryRef.current === trimmed) setLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [client, holderId],
  );

  function handleQueryChange(value: string) {
    setQuery(value);
    runSearch(value);
  }

  /** Go somewhere from the palette (closing it). `replace` is for same-page view-state
   *  changes (range, scope-less tweaks) that must not add a history entry. */
  function navigate(path: string, opts: { replace?: boolean } = {}) {
    // Suppress `useBackToClose`'s `history.back()` cleanup for this close — the dialog
    // is closing *to* a new route, not from a user back-press. Without this, the cleanup
    // effect can fire before Next.js has called `history.pushState` for the new route,
    // see the marker is still the top entry, and call `history.back()` — silently
    // cancelling the navigation. See `back-to-close-stack.ts` for the full writeup.
    suppressNextHistoryBack();
    handleOpenChange(false);
    if (opts.replace) router.replace(path);
    else router.push(path);
  }

  /** Current page + current params with `entry=<kind>` — the add-transaction menu owns
   *  this deep link (it opens the right sheet, then strips the param). */
  const entryHref = useCallback(
    (kind: "transaction" | "import") => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("entry", kind);
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams],
  );

  function switchScope(scope: ScopeSelection) {
    persistScopeCookie(scope);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const key of SCOPE_RESET_PARAMS) params.delete(key);
    params.set(SCOPE_PARAM, formatScopeParam(scope));
    // push, like the header switcher: a scope change is a navigation back should undo.
    navigate(`${pathname}?${params.toString()}`);
  }

  function runAction(id: string) {
    if (id === "add-transaction") navigate(entryHref("transaction"));
    else if (id === "import") navigate(entryHref("import"));
    else if (id === "toggle-theme") {
      setTheme(resolvedTheme === "dark" ? "light" : "dark");
      handleOpenChange(false);
    } else if (id === "shortcuts") {
      handleOpenChange(false);
      setHelpOpen(true);
    }
  }

  // Keyboard: Cmd/Ctrl-K always (even from a field); everything else is a plain-page
  // shortcut and is ignored while typing or with any dialog/menu open (see
  // `shouldIgnoreShortcut`). `g` arms a chord: `g h`, `g a`, `g r`, `g i`, `g s`.
  const chordRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    function disarm() {
      if (chordRef.current) clearTimeout(chordRef.current);
      chordRef.current = null;
    }
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        disarm();
        setOpen((v) => !v);
        return;
      }
      // Opt-out (Settings → Account): every single-key shortcut off; Cmd/Ctrl-K above stays.
      if (!readShortcutsEnabled() || shouldIgnoreShortcut(e)) {
        disarm();
        return;
      }
      if (chordRef.current) {
        disarm();
        const dest = GO_CHORDS[e.key.toLowerCase()];
        if (dest && !e.shiftKey) {
          e.preventDefault();
          router.push(scoped(dest));
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (!e.shiftKey && e.key === "n") {
        e.preventDefault();
        router.push(entryHref("transaction"));
      } else if (!e.shiftKey && e.key === "g") {
        chordRef.current = setTimeout(disarm, CHORD_TIMEOUT_MS);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      disarm();
    };
  }, [router, scoped, entryHref]);

  const instruments = results?.instruments ?? [];
  const transactions = results?.transactions ?? [];
  const hasResults = instruments.length > 0 || transactions.length > 0;
  const trimmedQuery = query.trim();

  // --- Command groups (filtered client-side by the query) -----------------------------
  const pages = COMMAND_PAGES.filter((p) => !p.adminOnly || isAdmin).map((p) => ({
    ...p,
    label: tNav(p.labelKey),
  }));
  const visiblePages = pages.filter((p) => matches(p.label, trimmedQuery));
  const recentPages =
    trimmedQuery === ""
      ? recent
          .map((href) => pages.find((p) => p.href === href))
          .filter((p): p is (typeof pages)[number] => !!p && p.href !== pathname)
      : [];

  const shownRecentInstruments = trimmedQuery === "" ? recentInstruments : [];
  const showAssistant = assistant.available && trimmedQuery !== "";

  const isDark = resolvedTheme === "dark";
  const actions = [
    { id: "add-transaction", label: t("actionAddTransaction"), icon: Plus, keys: "N" },
    { id: "import", label: t("actionImport"), icon: Upload, keys: undefined },
    {
      id: "toggle-theme",
      label: t("actionToggleTheme"),
      icon: isDark ? Sun : Moon,
      keys: undefined,
    },
    { id: "shortcuts", label: t("actionShortcuts"), icon: CircleHelp, keys: "?" },
  ].filter((a) => matches(a.label, trimmedQuery));

  // Page-contributed groups (registered by the current page; see `page-commands.tsx`).
  const visiblePageGroups = pageGroups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => matches(`${i.label} ${i.keywords ?? ""}`, trimmedQuery)),
    }))
    .filter((g) => g.items.length > 0);
  const pageCommandCount = visiblePageGroups.reduce((n, g) => n + g.items.length, 0);

  const holdersWithMany = scopes.holders.filter(
    (h) => scopes.portfolios.filter((p) => p.accountHolderId === h.id).length >= 2,
  );
  const scopeItems =
    scopes.portfolios.length >= 2
      ? [
          {
            id: "all",
            label: t("scopeTo", { name: t("scopeAll") }),
            icon: Layers,
            scope: { kind: "all" } as ScopeSelection,
          },
          ...holdersWithMany.map((h) => ({
            id: `h-${h.id}`,
            label: t("scopeTo", { name: h.name }),
            icon: Users,
            scope: { kind: "holder", holderId: h.id } as ScopeSelection,
          })),
          ...scopes.portfolios.map((p) => ({
            id: `p-${p.id}`,
            label: t("scopeTo", { name: p.name }),
            icon: Briefcase,
            scope: { kind: "portfolio", portfolioId: p.id } as ScopeSelection,
          })),
        ].filter((s) => matches(s.label, trimmedQuery))
      : [];

  // Includes shownRecentInstruments and showAssistant: they feed the empty-state computation below.
  const commandCount =
    recentPages.length +
    shownRecentInstruments.length +
    (showAssistant ? 1 : 0) +
    visiblePages.length +
    actions.length +
    pageCommandCount +
    scopeItems.length;
  const anything = commandCount > 0 || hasResults;

  // Determine which single empty-state message to show (mutually exclusive).
  // Error wins over every other state: an outstanding failure is more actionable than
  // a stale "Searching…" or a misleading "No results." that would otherwise be shown
  // while the previous request's results have been cleared. When commands are listed the
  // search status is a separate live-region line below instead (see `statusLine`).
  let emptyContent: string | null = null;
  if (!anything) {
    if (error) emptyContent = t("error");
    else if (loading) emptyContent = t("searching");
    else emptyContent = t("noResults");
  }
  const statusLine =
    anything && trimmedQuery !== ""
      ? error
        ? t("error")
        : loading && !hasResults
          ? t("searching")
          : null
      : null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("triggerLabel")}
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
      </Button>

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />

      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        {/* shouldFilter=false: server results come from ILIKE and commands are filtered
            above; cmdk must not re-filter either. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t("placeholder")}
            value={query}
            onValueChange={handleQueryChange}
          />
          <CommandList>
            {emptyContent !== null && <CommandEmpty>{emptyContent}</CommandEmpty>}

            {showAssistant && (
              <CommandGroup heading={t("groupAssistant")}>
                <CommandItem
                  value="assistant-ask"
                  onSelect={() => {
                    handleOpenChange(false);
                    assistant.open(trimmedQuery);
                  }}
                >
                  <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
                  {t("actionAssistant", { query: trimmedQuery })}
                </CommandItem>
              </CommandGroup>
            )}

            {(recentPages.length > 0 || shownRecentInstruments.length > 0) && (
              <CommandGroup heading={t("groupRecent")}>
                {recentPages.map((p) => (
                  <CommandItem
                    key={p.href}
                    value={`recent-${p.href}`}
                    onSelect={() => navigate(scoped(p.href))}
                  >
                    <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                    {p.label}
                  </CommandItem>
                ))}
                {shownRecentInstruments.map((r) => (
                  <CommandItem
                    key={`instrument-${r.id}`}
                    value={`recent-instrument-${r.id}`}
                    onSelect={() => navigate(scoped(`/instruments/${r.id}`))}
                  >
                    <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="font-mono text-sm font-medium">{r.symbol}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {visiblePages.length > 0 && (
              <CommandGroup heading={t("groupNavigate")}>
                {visiblePages.map((p) => (
                  <CommandItem
                    key={p.href}
                    value={`page-${p.href}`}
                    onSelect={() => navigate(scoped(p.href))}
                  >
                    <p.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {p.label}
                    {p.chord && (
                      <CommandShortcut aria-hidden="true">
                        G {p.chord.toUpperCase()}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {actions.length > 0 && (
              <CommandGroup heading={t("groupActions")}>
                {actions.map((a) => (
                  <CommandItem key={a.id} value={`action-${a.id}`} onSelect={() => runAction(a.id)}>
                    <a.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {a.label}
                    {a.keys && <CommandShortcut aria-hidden="true">{a.keys}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {visiblePageGroups.map((g) => (
              <CommandGroup key={g.id} heading={g.heading}>
                {g.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`page-command-${g.id}-${item.id}`}
                    onSelect={() => item.run({ navigate, close: () => handleOpenChange(false) })}
                  >
                    {item.icon && (
                      <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    )}
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}

            {scopeItems.length > 0 && (
              <CommandGroup heading={t("groupScope")}>
                {scopeItems.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`scope-${s.id}`}
                    onSelect={() => switchScope(s.scope)}
                  >
                    <s.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {instruments.length > 0 && (
              <CommandGroup heading={t("groupInstruments")}>
                {instruments.map((instr: SearchInstrumentResult) => (
                  <CommandItem
                    key={instr.id}
                    value={`instrument-${instr.id}`}
                    onSelect={() => navigate(`/instruments/${instr.id}`)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="font-mono text-sm font-medium">{instr.symbol}</span>
                      <span className="min-w-0 truncate text-sm text-muted-foreground">
                        {instr.name}
                      </span>
                    </div>
                    {!instr.owned && (
                      <span
                        className={cn(
                          "ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground",
                        )}
                      >
                        {t("catalogBadge")}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {transactions.length > 0 && (
              <CommandGroup heading={t("groupTransactions")}>
                {transactions.map((tx: SearchTransactionResult) => (
                  <CommandItem
                    key={tx.id}
                    value={`transaction-${tx.id}`}
                    onSelect={() => navigate(`/transactions/${tx.id}/edit`)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize">
                          {tx.type.replace(/_/g, " ")}
                        </span>
                        {tx.instrument && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {tx.instrument.symbol}
                          </span>
                        )}
                      </div>
                      {(tx.description ?? tx.portfolioName) && (
                        <span className="truncate text-xs text-muted-foreground">
                          {tx.description ?? tx.portfolioName}
                        </span>
                      )}
                    </div>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {new Date(tx.executedAt).toLocaleDateString(locale)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div role="status" aria-live="polite" className="empty:hidden">
            {statusLine && (
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                {statusLine}
              </p>
            )}
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
