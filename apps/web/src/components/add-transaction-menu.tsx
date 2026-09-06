"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  PenLine,
  FileSpreadsheet,
  Camera,
  ChevronLeft,
  Briefcase,
  UserPlus,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { SheetFooterChromeContext, SheetFooterContext } from "@/components/ui/sheet";
import { ImportFlowClient } from "@/components/import-flow-client";
import { NewEntryTabs, type NewEntryTab } from "@/components/new-entry-tabs";
import type { AddTransactionInitial } from "@/components/add-transaction-form";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ImportTargetPortfolio } from "@/components/import-flow/types";
import { PortfolioFormBody } from "@/components/portfolio-form-dialog/body";
import { HolderFormBody } from "@/components/holder-form-dialog/body";
import { MethodCard } from "@/components/add-transaction-menu/method-card";
import { loadHarvestPrefill } from "@/components/add-transaction-menu/helpers";
import { NavRail, type DesktopStep } from "@/components/add-transaction-menu/nav-rail";
import { EventsTabSwitch } from "@/components/add-transaction-menu/events-tab-switch";

type EventsTab = "corporate-action" | "merger";

/** Every reachable destination of the unified overlay. "choose" is the mobile-only
 *  chooser screen (never entered on a `md:`+ viewport — the rail replaces it there, see
 *  `onAddOpenChange`); every other value renders identically regardless of viewport. */
type Step = "choose" | "manual" | "import" | "events" | "portfolio" | "holder";

/** Entry-mode-specific dropzone copy for the import flow — see `UseImportFlowProps`. */
type ImportEntryMode = "screenshot" | "csv" | "file";

/**
 * The unified add-entry launcher, transcribed from `Pocket Prototype.dc.html`'s
 * ADD / IMPORT bottom sheet: step 1 offers "Snap a screenshot" / "Import a CSV" /
 * "Add manually" method cards; "Add manually" swaps the content (with a back button) to
 * the Transaction / Corporate action / Merger entry tabs. Screenshot and CSV both feed
 * the same unified import flow.
 *
 * One `Dialog`/`DialogContent` tree at every viewport (#669): a 196px left nav rail
 * (`max-md:hidden`) replaces the mobile chooser + back button at `md:`+, but every
 * step's content is the same mounted subtree either way — nothing here branches on
 * `isDesktop`/`isWide` to decide WHAT renders, only IF the rail or a back-chevron shows.
 *
 * `autoOpenFromParams` must be set on exactly ONE rendered instance per page — the global
 * shell instance. It owns the `?shared=1` / `?import=1` auto-open (PWA share-target and
 * shortcut). If two instances auto-opened, their `ImportFlowClient` mounts would race to
 * consume and clear the cached screenshot, so every inline instance leaves it `false`.
 * It also owns the `?harvestInstrument=`/`?entry=` deep links below, for the same
 * one-instance-reacts reason — `/transactions` and `/holdings` render a second,
 * page-local `AddTransactionMenu` alongside the shell's.
 */
export function AddTransactionMenu({
  autoOpenFromParams = false,
  isAdmin = false,
}: {
  autoOpenFromParams?: boolean;
  isAdmin?: boolean;
} = {}) {
  const tm = useTranslations("Manage");
  const ti = useTranslations("Import");
  const tca = useTranslations("CorpAction");
  const tmg = useTranslations("Merger");
  const api = useApiClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // AddTransactionForm's own internal two-column/Summary-rail layout threshold — an
  // in-scope-elsewhere concern (permitted to read live, per the repo's "internal layout
  // may branch on isDesktop; only the overlay tree itself may not" invariant). Threaded
  // through to NewEntryTabs below, unchanged from before the merge.
  const isDesktop = useMediaQuery("(min-width: 860px)");
  // The chrome/step-model breakpoint: matches the rail's own `md:` (768px) reveal.
  // Anything gating WHICH STEP is entered, or WHICH CONTENT SHAPE a step renders, must
  // use this — not `isDesktop` — or the rail can end up visible (`md:`+) while the step
  // machinery still thinks it's in the narrower, chooser-driven regime.
  const isWide = useMediaQuery("(min-width: 768px)");

  const [addOpen, setAddOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  // Whether the "manual" step should render its desktop-rail shape (transaction tab
  // only, tab list hidden) instead of mobile's full transaction/corporate-action/merger
  // switcher. Snapshotted at each transition INTO "manual" (see `openManual` and the two
  // other call sites below) rather than read live from `isWide` — the same fix pattern
  // as `step` itself: a value read reactively here would let a resize while a
  // corporate-action/merger tab is filled in unmount that tab (`NewEntryTabs`'
  // `visibleTabs` conditionally mounts `TabsContent`), silently discarding it. Snapshotting
  // means a resize while "manual" is open changes only chrome (the rail's visibility),
  // never content.
  const [manualStepDesktop, setManualStepDesktop] = useState(false);
  // The persistent footer's portal-target DOM node — see `SheetFooterContext` below.
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const [portfolios, setPortfolios] = useState<ImportTargetPortfolio[] | null>(null);
  const [defaultPortfolioId, setDefaultPortfolioId] = useState("");
  const [manualDefaultTab, setManualDefaultTab] = useState<NewEntryTab>("transaction");
  // The desktop rail's "Instrument event" destination hosts its own Corp. action/Merger
  // 2-way switch (`EventsTabSwitch`) instead of `NewEntryTabs`' internal `TabsList`
  // (`hideTabList`) — this is that switch's controlled value.
  const [eventsTab, setEventsTab] = useState<EventsTab>("corporate-action");
  const [importEntryMode, setImportEntryMode] = useState<ImportEntryMode>("file");
  const [initialTransaction, setInitialTransaction] = useState<AddTransactionInitial | undefined>(
    undefined,
  );
  // Forces a fresh `NewEntryTabs` mount whenever a deep link sets a new default tab /
  // prefill: `Tabs`' `defaultValue` and the form's `initial` prop are both lazy
  // (uncontrolled) initializers, so changing them on an already-mounted instance
  // wouldn't otherwise take effect.
  const [entryNonce, setEntryNonce] = useState(0);
  // Whether at least one account holder exists — gates the "Add account holder" card.
  const [hasHolders, setHasHolders] = useState(true);
  // The mobile FAB below is portaled to `document.body` (see its render site) so its
  // `fixed` positioning isn't hijacked by the shell header's `will-change-transform`
  // (that property establishes a containing block for fixed descendants, same as an
  // actual `transform` would — it silently pinned the FAB ~112px above the header's
  // bottom edge, off the top of the viewport, ever since #532 landed). `document` is
  // unavailable during SSR, so the portal only renders once mounted client-side.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // "choose" is the mobile-only chooser — the rail has no equivalent destination for
  // it, so a LIVE widen across `md:` while it's open (a resize, an orientation flip, a
  // devtools device-toolbar toggle) would otherwise leave the rail visible and
  // highlighting the wrong item while the chooser cards are still what's rendered (see
  // #669's PR discussion). Unlike the deleted shrink-reset effect this replaces in
  // spirit, this is safe in the opposite direction: "choose" holds no user input to
  // lose, so re-entering "manual" here can't discard anything, and it mirrors exactly
  // what opening the dialog fresh at this width already does (`onAddOpenChange`, below).
  useEffect(() => {
    if (!addOpen || !isWide || step !== "choose") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManualStepDesktop(true);
    setStep("manual");
  }, [addOpen, isWide, step]);

  // A screenshot shared into the app lands on /transactions?shared=1 (see sw.ts); the
  // "Import screenshot" PWA shortcut lands on ?import=1. Either auto-opens the import sheet
  // — but only on the single instance that owns this (see the prop doc above).
  useEffect(() => {
    if (!autoOpenFromParams) return;
    const shared = searchParams.get("shared") === "1";
    const importFlag = searchParams.get("import") === "1";
    if (shared || importFlag) void openImport();
    // `shared` is consumed + cleared by ImportFlowClient once it mounts (it needs the
    // param to fetch the cached image first); clear the bare `import` flag here so a
    // refresh doesn't re-open the sheet.
    if (importFlag && !shared) router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links onto the manual-entry tabs: the tax page's "Harvest" CTA
  // (`?harvestInstrument=<id>` — opens a Sell draft prefilled for that instrument) and
  // bookmarked corporate-action/merger links (`?entry=corporate-action|merger`, from the
  // retired `/transactions/new` full page — see its redirect). Unlike the mount-only
  // effect above, this one is reactive to the params themselves (not `[]`): the harvest
  // CTA is a same-page `<Link>` navigation from `/tax`, which re-renders this already-
  // mounted component rather than remounting it. Depending on the extracted primitive
  // values (not the `searchParams` object) keeps this from re-firing on every render —
  // `useSearchParams()` doesn't guarantee a stable object identity across renders.
  const harvestInstrumentParam = searchParams.get("harvestInstrument");
  const entryParam = searchParams.get("entry");
  useEffect(() => {
    if (!autoOpenFromParams) return;
    if (!harvestInstrumentParam && !entryParam) return;

    let cancelled = false;
    void (async () => {
      const loaded = await loadPortfolios();
      if (cancelled) return;
      const targetPortfolioId = loaded[0]?.id ?? "";

      let targetTab: NewEntryTab = "transaction";
      if (harvestInstrumentParam) {
        const prefill = await loadHarvestPrefill(api, harvestInstrumentParam, targetPortfolioId);
        if (cancelled) return;
        setInitialTransaction(prefill ?? undefined);
        setManualDefaultTab("transaction");
      } else {
        targetTab =
          entryParam === "corporate-action" || entryParam === "merger" ? entryParam : "transaction";
        setInitialTransaction(undefined);
        setManualDefaultTab(targetTab);
      }
      setEntryNonce((n) => n + 1);
      setAddOpen(true);
      if (targetTab === "corporate-action" || targetTab === "merger") setEventsTab(targetTab);
      // On desktop, a corporate-action/merger deep link routes to the rail's "Instrument
      // event" destination instead of "Add transaction" (which is transaction-only there —
      // see `NewEntryTabs`' `visibleTabs` wiring below).
      if (isWide && targetTab !== "transaction") {
        setStep("events");
      } else {
        setManualStepDesktop(isWide);
        setStep("manual");
      }
      router.replace(pathname);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harvestInstrumentParam, entryParam]);

  async function loadPortfolios() {
    if (portfolios !== null) return portfolios;
    const [fetched, holders] = await Promise.all([api.listPortfolios(), api.listAccountHolders()]);
    const mapped = fetched.map((p) => ({
      id: p.id,
      name: p.name,
      brokerage: p.brokerage,
      accountHolder: p.accountHolder,
    }));
    setPortfolios(mapped);
    setDefaultPortfolioId(mapped[0]?.id ?? "");
    setHasHolders(holders.length > 0);
    return mapped;
  }

  async function openImport(entryMode: ImportEntryMode = "file") {
    await loadPortfolios();
    setImportEntryMode(entryMode);
    setAddOpen(true);
    setStep("import");
  }

  async function openManual() {
    await loadPortfolios();
    // Plain manual entry (the "Add manually" card / desktop rail's "Add transaction") always
    // starts a blank Transaction tab — reset any leftover deep-link prefill from a previous
    // open.
    setInitialTransaction(undefined);
    setManualDefaultTab("transaction");
    setEntryNonce((n) => n + 1);
    setManualStepDesktop(isWide);
    setStep("manual");
  }

  /** Desktop rail only — "Instrument event" hosts corporate-action/merger. */
  async function openEvents(tab: EventsTab = "corporate-action") {
    await loadPortfolios();
    setEventsTab(tab);
    setStep("events");
  }

  function onAddOpenChange(open: boolean) {
    setAddOpen(open);
    if (open) {
      // Honest at open time: on a `md:`+ viewport, land directly on "manual" (the rail's
      // default destination) instead of a "choose" step the rail has no back-button path
      // out of. Below `md:`, "choose" is the real first screen. This used to be a
      // DISPLAY-only derivation (`step` always started at "choose", desktop merely
      // rendered it as "manual") — resizing while that lie was live could unmount a
      // freshly-typed form the moment "choose" started rendering for real. `step` now
      // matches what's on screen at every width, always.
      if (isWide) {
        setManualStepDesktop(true);
        setStep("manual");
      } else {
        setStep("choose");
      }
      void loadPortfolios();
    }
  }

  /** Desktop nav-rail click → the corresponding step, reusing the same open/prefill logic
   *  the mobile chooser cards use for "import"/"manual" so behavior stays identical. */
  function onSelectStep(next: DesktopStep) {
    if (next === "import") void openImport("file");
    else if (next === "manual") void openManual();
    else if (next === "events") void openEvents();
    else setStep(next);
  }

  // Invalidates the local portfolio/holder cache after a dialog creates or edits one,
  // so the next sheet interaction re-fetches fresh data.
  function onDialogSuccess() {
    setPortfolios(null);
    setHasHolders(true);
  }

  const dismissible = step !== "import";
  // The shared Cancel+submit-portal footer bar: absent for "import" (its own step-local
  // upload/parsing/review actions, unchanged from before the merge) and "choose" (the
  // mobile chooser has no footer — matches its pre-merge, footer-less Sheet rendering).
  const showFooter = step !== "import" && step !== "choose";
  // Only "manual" uses the two-column form+Summary-rail-width grid; every other step
  // (choose/events/portfolio/holder/import) gets a centered, max-width-600px column.
  const centered = step !== "manual";
  const headerTitle =
    step === "choose"
      ? tm("addMenu.title")
      : step === "import"
        ? ti("title")
        : step === "manual"
          ? tm("addMenu.railAddTransaction")
          : step === "events"
            ? tm("addMenu.railInstrumentEvent")
            : step === "portfolio"
              ? tm("addMenu.createPortfolio")
              : tm("addMenu.createAccountHolder");

  const content =
    step === "choose" ? (
      <>
        <p className="mx-0.5 mb-3.5 text-[13px] font-medium text-text-2">
          {tm("addMenu.subtitle")}
        </p>
        <div className="flex flex-col gap-3">
          <MethodCard
            icon={Camera}
            title={tm("addMenu.screenshot")}
            description={tm("addMenu.screenshotDesc")}
            tone="green"
            tag={tm("addMenu.recommended")}
            onClick={() => void openImport("screenshot")}
          />
          <MethodCard
            icon={FileSpreadsheet}
            title={tm("addMenu.csv")}
            description={tm("addMenu.csvDesc")}
            tone="violet"
            onClick={() => void openImport("csv")}
          />
          <MethodCard
            icon={PenLine}
            title={tm("addMenu.manual")}
            description={tm("addMenu.manualDesc")}
            tone="gold"
            onClick={() => void openManual()}
          />
        </div>

        <hr className="my-2 border-border" />

        <div className="flex flex-col gap-3">
          <MethodCard
            icon={Briefcase}
            title={tm("addMenu.createPortfolio")}
            description={tm("addMenu.createPortfolioDesc")}
            tone="blue"
            onClick={() => setStep("portfolio")}
          />
          {!hasHolders && (
            <MethodCard
              icon={UserPlus}
              title={tm("addMenu.createAccountHolder")}
              description={tm("addMenu.createAccountHolderDesc")}
              tone="orange"
              onClick={() => setStep("holder")}
            />
          )}
        </div>
      </>
    ) : step === "manual" ? (
      portfolios && (
        <NewEntryTabs
          key={entryNonce}
          portfolios={portfolios}
          initialPortfolioId={defaultPortfolioId}
          defaultTab={manualStepDesktop ? "transaction" : manualDefaultTab}
          initialTransaction={initialTransaction}
          stickyFooter
          isAdmin={isAdmin}
          isDesktop={isDesktop}
          hideTabList={manualStepDesktop}
          visibleTabs={manualStepDesktop ? ["transaction"] : undefined}
        />
      )
    ) : step === "events" ? (
      portfolios && (
        <>
          <EventsTabSwitch
            value={eventsTab}
            onChange={setEventsTab}
            labels={{ corporateAction: tca("link"), merger: tmg("link") }}
          />
          <NewEntryTabs
            key={entryNonce}
            portfolios={portfolios}
            initialPortfolioId={defaultPortfolioId}
            value={eventsTab}
            onValueChange={(tab) => setEventsTab(tab as EventsTab)}
            stickyFooter
            isAdmin={isAdmin}
            isDesktop={isDesktop}
            hideTabList
            visibleTabs={["corporate-action", "merger"]}
          />
        </>
      )
    ) : step === "portfolio" ? (
      <PortfolioFormBody mode="create" onSuccess={onDialogSuccess} onDone={openManual} />
    ) : step === "holder" ? (
      <HolderFormBody
        mode="create"
        onSuccess={() => {
          onDialogSuccess();
          void openManual();
        }}
      />
    ) : (
      portfolios && (
        <ImportFlowClient
          portfolios={portfolios}
          defaultPortfolioId={defaultPortfolioId}
          onClose={() => onAddOpenChange(false)}
          entryMode={importEntryMode}
        />
      )
    );

  return (
    <>
      <Button
        aria-label={tm("addTransaction")}
        onClick={() => onAddOpenChange(true)}
        className={autoOpenFromParams ? "hidden md:inline-flex" : undefined}
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">{tm("addMenu.add")}</span>
      </Button>
      {autoOpenFromParams &&
        mounted &&
        createPortal(
          <Button
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-6 z-40 size-14 rounded-[18px] shadow-lg md:hidden"
            aria-label={tm("addTransaction")}
            onClick={() => onAddOpenChange(true)}
          >
            <Plus className="size-6" />
          </Button>,
          document.body,
        )}

      <Dialog open={addOpen} onOpenChange={onAddOpenChange}>
        {/* size="xl" matches the 1080px desktop width this shell has always used; the
            rest of the geometry below is `md:`-prefixed on top of `DialogContent`'s own
            full-screen-mobile/centered-desktop defaults — every class here used to be
            unconditional in the pre-merge `desktop-shell.tsx`, which only ever mounted
            on desktop and so never had to coexist with those mobile defaults. */}
        <DialogContent
          hideClose
          size="xl"
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          className="flex flex-row gap-0 overflow-hidden bg-background p-0 md:w-[calc(100%-4rem)] md:rounded-[22px] md:border-0 md:shadow-[0_30px_80px_rgba(0,0,0,.4)] md:max-h-[calc(100dvh-64px)]"
        >
          <NavRail
            className="max-md:hidden"
            active={step === "choose" ? "manual" : step}
            onSelect={onSelectStep}
            labels={{
              heading: tm("addMenu.desktopHeading"),
              import: tm("addMenu.railImport"),
              manual: tm("addMenu.railAddTransaction"),
              events: tm("addMenu.railInstrumentEvent"),
              portfolio: tm("addMenu.railCreatePortfolio"),
              holder: tm("addMenu.railAccountHolder"),
            }}
          />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="sticky top-0 z-[2] flex flex-row items-center gap-2.5 border-b border-border bg-background px-5 py-3 md:px-[26px] md:py-[18px]">
              {step !== "choose" && (
                <button
                  type="button"
                  onClick={() => setStep("choose")}
                  aria-label={tm("back")}
                  className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-card text-foreground shadow-[0_1px_2px_rgba(15,27,20,.08)] md:hidden"
                >
                  <ChevronLeft className="size-[18px]" strokeWidth={2.2} />
                </button>
              )}
              <DialogTitle className="flex-1 text-[19px] font-extrabold leading-none text-foreground">
                {headerTitle}
              </DialogTitle>
              {/* Mobile-only close — desktop has no floating X, only the footer's Cancel
                  (mirrors the pre-merge desktop shell's `hideClose`). Unlike `dismissible`
                  above (which only guards Esc/outside-click), this stays clickable even
                  mid-import — the pre-merge mobile Sheet's built-in close button worked
                  the same way. */}
              <DialogClose
                className="flex size-[34px] shrink-0 items-center justify-center rounded-[11px] bg-card text-foreground shadow-[0_1px_2px_rgba(15,27,20,.08)] md:hidden"
                aria-label="Close"
              >
                <X className="size-[18px]" strokeWidth={2.2} />
              </DialogClose>
            </div>

            <SheetFooterChromeContext.Provider value={showFooter}>
              <SheetFooterContext.Provider value={footerEl}>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div
                    className={
                      centered
                        ? "mx-auto max-w-[600px] px-5 py-4 md:px-[26px] md:py-5"
                        : "px-5 py-4 md:px-[26px] md:py-5"
                    }
                  >
                    {content}
                  </div>
                </div>

                {showFooter && (
                  <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-background px-5 py-3 max-md:pb-[env(safe-area-inset-bottom)] md:px-[26px] md:py-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onAddOpenChange(false)}
                      className="h-auto max-md:hidden rounded-[13px] border-border bg-card px-[22px] py-[13px] text-[14px] font-bold text-foreground hover:bg-card"
                    >
                      {tm("addMenu.cancel")}
                    </Button>
                    {/* `display:contents` so the portaled submit button (via
                        `useSheetFooter`) lands as a flex sibling of Cancel above, in DOM
                        order — not visually nested inside this otherwise-empty div. */}
                    <div ref={setFooterEl} className="contents" />
                  </div>
                )}
              </SheetFooterContext.Provider>
            </SheetFooterChromeContext.Provider>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
