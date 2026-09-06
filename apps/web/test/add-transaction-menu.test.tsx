import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../messages/en.json";
import { useSheetFooterChrome } from "@/components/ui/sheet";

const search = { value: "" };

// next/navigation's useSearchParams drives the auto-open effect.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
}));

const listPortfolios = vi.fn(
  async () =>
    [] as { id: string; name: string; brokerage: string | null; accountHolder: string | null }[],
);
const listAccountHolders = vi.fn(async () => [] as { id: string; name: string }[]);
const getInstrument = vi.fn();
const getSummary = vi.fn();
vi.mock("@/lib/api", () => ({
  useApiClient: () => ({ listPortfolios, listAccountHolders, getInstrument, getSummary }),
}));

// Stub the heavy flows — we only assert the right step/sheet renders. Each stub also
// probes `useSheetFooterChrome()` (real, unmocked `ui/sheet.tsx`) so tests can assert
// `add-transaction-menu.tsx`'s `SheetFooterChromeContext.Provider` is wired the same way
// the deleted `desktop-shell.test.tsx` regression-tested — see "marks the shared footer
// as already-styled for every step except import" below.
vi.mock("@/components/import-flow-client", () => ({
  ImportFlowClient: () => (
    <div data-testid="import-flow">
      <ChromeProbe testId="chrome-probe-import" />
    </div>
  ),
}));
// Captures the props NewEntryTabs was last rendered with, so deep-link tests can assert
// the tab/prefill actually threaded through rather than just that the sheet opened.
const lastEntryTabsProps = { current: null as Record<string, unknown> | null };
// Counts real mounts (not re-renders) of the stub — the #669 regression is a viewport
// resize forcing an actual unmount/remount of the manual step's form, which a bare
// render-call count can't distinguish from a harmless prop update.
const entryTabsMountCount = { current: 0 };
vi.mock("@/components/new-entry-tabs", () => ({
  NewEntryTabs: (props: Record<string, unknown>) => {
    lastEntryTabsProps.current = props;
    useEffect(() => {
      entryTabsMountCount.current += 1;
    }, []);
    return (
      <div data-testid="entry-tabs">
        <ChromeProbe testId="chrome-probe-manual" />
      </div>
    );
  },
}));

function ChromeProbe({ testId }: { testId: string }) {
  const hasChrome = useSheetFooterChrome();
  return <span data-testid={testId}>{hasChrome ? "styled" : "bare"}</span>;
}

import { AddTransactionMenu } from "../src/components/add-transaction-menu";

function renderMenu(props: { autoOpenFromParams?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AddTransactionMenu {...props} />
    </NextIntlClientProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: messages.Manage.addTransaction }));
}

/** Fixed matchMedia mock — every query (isWide's 768px and isDesktop's 860px alike)
 *  resolves to the same `matches` value, which is enough to pin either the mobile or
 *  the rail-driven regime without distinguishing the two breakpoints. */
function mockMatchMedia(matches: boolean) {
  const fn = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  window.matchMedia = fn;
  return fn;
}

/** A `matchMedia` mock that can flip live, for testing what happens when a resize
 *  crosses the breakpoint mid-render — see `edit-transaction-sheet.test.tsx`'s copy of
 *  this same helper for the underlying `useSyncExternalStore` mechanics. */
function mockMatchMediaDynamic(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    resize(next: boolean) {
      matches = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

describe("AddTransactionMenu", () => {
  beforeEach(() => {
    search.value = "";
    replace.mockClear();
    listPortfolios.mockClear();
    listPortfolios.mockResolvedValue([]);
    listAccountHolders.mockClear();
    listAccountHolders.mockResolvedValue([]);
    getInstrument.mockReset();
    getSummary.mockReset();
    lastEntryTabsProps.current = null;
    entryTabsMountCount.current = 0;
  });

  afterEach(() => {
    // Restore jsdom's default (matches: false) so later tests aren't affected.
    mockMatchMedia(false);
  });

  it("opens the add sheet with the three reference method cards", () => {
    renderMenu();
    openMenu();

    expect(screen.getByRole("dialog", { name: messages.Manage.addMenu.title })).toBeInTheDocument();
    expect(screen.getByText(messages.Manage.addMenu.screenshot)).toBeInTheDocument();
    expect(screen.getByText(messages.Manage.addMenu.recommended)).toBeInTheDocument();
    expect(screen.getByText(messages.Manage.addMenu.csv)).toBeInTheDocument();
    expect(screen.getByText(messages.Manage.addMenu.manual)).toBeInTheDocument();
  });

  it("swaps to the in-sheet manual entry tabs from the manual card", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(messages.Manage.addMenu.manual));
    await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
    // ...and a back button returns to the method cards.
    fireEvent.click(screen.getByRole("button", { name: messages.Manage.back }));
    expect(screen.getByText(messages.Manage.addMenu.screenshot)).toBeInTheDocument();
  });

  it("opens the import sheet from the screenshot card and closes the add sheet", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(messages.Manage.addMenu.screenshot));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: messages.Import.title })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("dialog", { name: messages.Manage.addMenu.title }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("import-flow")).toBeInTheDocument();
  });

  // Regression test for #471: the CSV card called the same `openImport()` path as
  // screenshot but closing one Drawer.Root and opening a second in the same tick raced
  // vaul's body-scroll-lock cleanup, so the import sheet never became interactive.
  it("opens the import sheet from the CSV card too", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(messages.Manage.addMenu.csv));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: messages.Import.title })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("import-flow")).toBeInTheDocument();
  });

  it("returns from the import step to the method cards via back, without closing the sheet", async () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByText(messages.Manage.addMenu.screenshot));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: messages.Import.title })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: messages.Manage.back }));

    expect(screen.getByRole("dialog", { name: messages.Manage.addMenu.title })).toBeInTheDocument();
    expect(screen.getByText(messages.Manage.addMenu.csv)).toBeInTheDocument();
  });

  it("keeps the import sheet closed without a share/import param", () => {
    renderMenu();
    expect(screen.queryByRole("dialog", { name: messages.Import.title })).not.toBeInTheDocument();
  });

  it("auto-opens the import sheet on ?import=1 and clears the flag", async () => {
    search.value = "import=1";
    renderMenu({ autoOpenFromParams: true });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: messages.Import.title })).toBeInTheDocument(),
    );
    expect(replace).toHaveBeenCalledWith("/transactions");
  });

  it("auto-opens on ?shared=1 but leaves the param for ImportFlowClient", async () => {
    search.value = "shared=1";
    renderMenu({ autoOpenFromParams: true });
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: messages.Import.title })).toBeInTheDocument(),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("ignores share/import params without autoOpenFromParams (only one instance owns it)", async () => {
    search.value = "import=1";
    renderMenu();
    await Promise.resolve();
    expect(screen.queryByRole("dialog", { name: messages.Import.title })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  describe("portfolio and account-holder shortcuts", () => {
    it("shows the Add portfolio card (always visible)", () => {
      renderMenu();
      openMenu();
      expect(screen.getByText(messages.Manage.addMenu.createPortfolio)).toBeInTheDocument();
    });

    it("shows the Add account holder card when no holders exist", async () => {
      listAccountHolders.mockResolvedValue([]);
      renderMenu();
      openMenu();

      // Initially hidden (hasHolders starts true), then appears after fetch.
      await waitFor(() =>
        expect(screen.getByText(messages.Manage.addMenu.createAccountHolder)).toBeInTheDocument(),
      );
    });

    it("hides the Add account holder card when holders already exist", async () => {
      listAccountHolders.mockResolvedValue([{ id: "h1", name: "Me" }]);
      renderMenu();
      openMenu();

      await waitFor(() => {
        expect(
          screen.queryByText(messages.Manage.addMenu.createAccountHolder),
        ).not.toBeInTheDocument();
      });
    });
  });

  // Deep-link params from the retired `/transactions/new` page's redirect + the tax
  // page's harvest CTA (#505 consolidation).
  describe("manual-entry deep links", () => {
    it("auto-opens the manual entry tabs on ?entry=corporate-action and clears the param", async () => {
      search.value = "entry=corporate-action";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(lastEntryTabsProps.current).toMatchObject({
        defaultTab: "corporate-action",
        initialTransaction: undefined,
      });
      expect(replace).toHaveBeenCalledWith("/transactions");
    });

    it("auto-opens the manual entry tabs on ?entry=merger", async () => {
      search.value = "entry=merger";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(lastEntryTabsProps.current).toMatchObject({ defaultTab: "merger" });
    });

    it("ignores an unrecognized ?entry value, falling back to the transaction tab", async () => {
      search.value = "entry=bogus";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(lastEntryTabsProps.current).toMatchObject({ defaultTab: "transaction" });
    });

    it("ignores ?entry without autoOpenFromParams (only the shell instance owns it)", async () => {
      search.value = "entry=merger";
      renderMenu();
      await Promise.resolve();
      expect(screen.queryByTestId("entry-tabs")).not.toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it("prefills a Sell draft from ?harvestInstrument=<id>, summing open lots in the first portfolio", async () => {
      listPortfolios.mockResolvedValue([
        { id: "p1", name: "Main", brokerage: null, accountHolder: null },
      ]);
      getInstrument.mockResolvedValue({
        id: "i1",
        symbol: "NVDA",
        name: "NVIDIA Corp",
        assetClass: "equity",
        unit: "shares",
        currency: "USD",
      });
      getSummary.mockResolvedValue({
        displayCurrency: "IDR",
        holdings: [
          {
            instrumentId: "i1",
            lots: [
              { acqDate: "2024-01-01", qty: "2", unitCost: "10", cost: "20" },
              { acqDate: "2024-06-01", qty: "3", unitCost: "12", cost: "36" },
            ],
          },
        ],
      });
      search.value = "harvestInstrument=i1";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(getSummary).toHaveBeenCalledWith("p1");
      expect(lastEntryTabsProps.current).toMatchObject({
        defaultTab: "transaction",
        initialTransaction: {
          type: "sell",
          instrumentId: "i1",
          instrument: { symbol: "NVDA", name: "NVIDIA Corp", assetClass: "equity", unit: "shares" },
          currency: "USD",
          quantity: "5",
        },
      });
      expect(replace).toHaveBeenCalledWith("/transactions");
    });

    it("leaves quantity blank when the harvested instrument isn't held", async () => {
      listPortfolios.mockResolvedValue([
        { id: "p1", name: "Main", brokerage: null, accountHolder: null },
      ]);
      getInstrument.mockResolvedValue({
        id: "i2",
        symbol: "ASML",
        name: "ASML Holding",
        assetClass: "equity",
        unit: "shares",
        currency: "EUR",
      });
      getSummary.mockResolvedValue({ displayCurrency: "IDR", holdings: [] });
      search.value = "harvestInstrument=i2";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(lastEntryTabsProps.current).toMatchObject({
        initialTransaction: { quantity: "" },
      });
    });

    it("still opens the manual tabs with no prefill when the harvest lookup fails", async () => {
      listPortfolios.mockResolvedValue([
        { id: "p1", name: "Main", brokerage: null, accountHolder: null },
      ]);
      getInstrument.mockRejectedValue(new Error("not found"));
      getSummary.mockResolvedValue({ displayCurrency: "IDR", holdings: [] });
      search.value = "harvestInstrument=ghost";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(lastEntryTabsProps.current).toMatchObject({ initialTransaction: undefined });
    });

    it("routes a corporate-action deep link to the rail's Instrument event step at a wide viewport", async () => {
      mockMatchMedia(true);
      listPortfolios.mockResolvedValue([
        { id: "p1", name: "Main", brokerage: null, accountHolder: null },
      ]);
      search.value = "entry=corporate-action";
      renderMenu({ autoOpenFromParams: true });

      await waitFor(() =>
        expect(
          screen.getByRole("dialog", { name: messages.Manage.addMenu.railInstrumentEvent }),
        ).toBeInTheDocument(),
      );
      expect(replace).toHaveBeenCalledWith("/transactions");
    });
  });

  // #669: AddTransactionMenu and DesktopShell merged into one tree — the rail
  // (`max-md:hidden`) replaces the mobile chooser at `md:`+ instead of a second,
  // separately-mounted component swapped in via `isDesktop`.
  describe("merged desktop rail (#669)", () => {
    it("opens directly on the manual step at a wide viewport, skipping the chooser", async () => {
      mockMatchMedia(true);
      renderMenu();
      openMenu();

      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(
        screen.getByRole("dialog", { name: messages.Manage.addMenu.railAddTransaction }),
      ).toBeInTheDocument();
      expect(screen.queryByText(messages.Manage.addMenu.screenshot)).not.toBeInTheDocument();
    });

    it("switches step and header title as each rail destination is clicked", async () => {
      mockMatchMedia(true);
      renderMenu();
      openMenu();
      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());

      fireEvent.click(
        screen.getByRole("button", { name: messages.Manage.addMenu.railInstrumentEvent }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole("dialog", { name: messages.Manage.addMenu.railInstrumentEvent }),
        ).toBeInTheDocument(),
      );

      fireEvent.click(
        screen.getByRole("button", { name: messages.Manage.addMenu.railCreatePortfolio }),
      );
      expect(
        screen.getByRole("dialog", { name: messages.Manage.addMenu.createPortfolio }),
      ).toBeInTheDocument();
      // The anti-nesting check: the rail's "Create portfolio" destination renders
      // PortfolioFormBody inline, not a second, separately-controlled Dialog on top.
      expect(screen.getAllByRole("dialog")).toHaveLength(1);

      fireEvent.click(
        screen.getByRole("button", { name: messages.Manage.addMenu.railAccountHolder }),
      );
      expect(
        screen.getByRole("dialog", { name: messages.Manage.addMenu.createAccountHolder }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("keeps the manual step's NewEntryTabs mounted, and its props stable, across a live viewport resize", async () => {
      const media = mockMatchMediaDynamic(false);
      renderMenu();
      openMenu();
      fireEvent.click(screen.getByText(messages.Manage.addMenu.manual));
      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(entryTabsMountCount.current).toBe(1);
      expect(lastEntryTabsProps.current).toMatchObject({
        hideTabList: false,
        visibleTabs: undefined,
      });

      // A resize while "manual" is open must not change the step's own shape — the
      // desktop/mobile split is decided once, at the transition into the step (see
      // `manualStepDesktop` in add-transaction-menu.tsx), specifically so a live
      // viewport crossing can never unmount (and so discard) an in-progress form.
      media.resize(true);
      expect(entryTabsMountCount.current).toBe(1);
      expect(lastEntryTabsProps.current).toMatchObject({
        hideTabList: false,
        visibleTabs: undefined,
      });

      media.resize(false);
      expect(entryTabsMountCount.current).toBe(1);
    });

    it("routes the mobile chooser's portfolio/holder cards to inline steps, not a nested dialog", async () => {
      listAccountHolders.mockResolvedValue([]);
      renderMenu();
      openMenu();
      await waitFor(() =>
        expect(screen.getByText(messages.Manage.addMenu.createAccountHolder)).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByText(messages.Manage.addMenu.createPortfolio));
      expect(
        screen.getByRole("dialog", { name: messages.Manage.addMenu.createPortfolio }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: messages.Manage.back }));
      fireEvent.click(screen.getByText(messages.Manage.addMenu.createAccountHolder));
      expect(
        screen.getByRole("dialog", { name: messages.Manage.addMenu.createAccountHolder }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
    });

    it("shows no shared footer bar on the mobile chooser step", () => {
      renderMenu();
      openMenu();
      expect(
        screen.queryByRole("button", { name: messages.Manage.addMenu.cancel }),
      ).not.toBeInTheDocument();
    });

    it("hides the shared footer during import but shows it for every other step", async () => {
      mockMatchMedia(true);
      renderMenu();
      openMenu();
      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(
        screen.getByRole("button", { name: messages.Manage.addMenu.cancel }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: messages.Manage.addMenu.railImport }));
      await waitFor(() => expect(screen.getByTestId("import-flow")).toBeInTheDocument());
      expect(
        screen.queryByRole("button", { name: messages.Manage.addMenu.cancel }),
      ).not.toBeInTheDocument();
    });

    // Regression test for the bug the deleted `desktop-shell.test.tsx` guarded against
    // (#674): a self-portaling submit button double-wrapping itself in footer chrome
    // when `SheetFooterChromeContext` isn't correctly threaded through to it.
    it("marks the shared footer as already-styled for every step except import", async () => {
      mockMatchMedia(true);
      renderMenu();
      openMenu();
      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(screen.getByTestId("chrome-probe-manual")).toHaveTextContent("styled");

      fireEvent.click(screen.getByRole("button", { name: messages.Manage.addMenu.railImport }));
      await waitFor(() => expect(screen.getByTestId("import-flow")).toBeInTheDocument());
      expect(screen.getByTestId("chrome-probe-import")).toHaveTextContent("bare");
    });

    // A live resize/orientation-flip/devtools-toolbar toggle across `md:` while the
    // mobile-only chooser is open has no CSS-only equivalent to land on (the rail has no
    // "choose" destination) — without this, the rail would show and highlight the wrong
    // item while the chooser cards kept rendering underneath it.
    it("self-heals off the mobile chooser when a live resize crosses into the rail's width", async () => {
      const media = mockMatchMediaDynamic(false);
      renderMenu();
      openMenu();
      expect(screen.getByText(messages.Manage.addMenu.screenshot)).toBeInTheDocument();

      media.resize(true);
      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());
      expect(screen.queryByText(messages.Manage.addMenu.screenshot)).not.toBeInTheDocument();
      expect(
        screen.getByRole("dialog", { name: messages.Manage.addMenu.railAddTransaction }),
      ).toBeInTheDocument();
    });

    it("keeps the rail, back-chevron, and desktop Cancel button CSS-hidden rather than conditionally mounted", async () => {
      // Default (mobile) matchMedia — if these were viewport-gated by JS instead of
      // `max-md:`/`md:` classes, none of them would be in the DOM at all here.
      renderMenu();
      openMenu();
      fireEvent.click(screen.getByText(messages.Manage.addMenu.manual));
      await waitFor(() => expect(screen.getByTestId("entry-tabs")).toBeInTheDocument());

      const back = screen.getByRole("button", { name: messages.Manage.back });
      expect(back.className).toContain("md:hidden");

      const cancel = screen.getByRole("button", { name: messages.Manage.addMenu.cancel });
      expect(cancel.className).toContain("max-md:hidden");

      const rail = screen
        .getByRole("button", { name: messages.Manage.addMenu.railImport })
        .closest("aside");
      expect(rail?.className).toContain("max-md:hidden");
    });
  });
});
